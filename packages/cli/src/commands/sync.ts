/**
 * Sync command - sync scan results to SecurityChecks cloud
 */

import pc from 'picocolors';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Finding } from '@securitychecks/collector';
import {
  loadCloudConfig,
  updateCloudConfig,
  getApiUrl,
  getProject,
  getApiKey,
} from '../lib/cloud-config.js';
import { createCloudClient } from '../lib/cloud-api.js';
import { CLIError, ErrorCodes } from '../lib/errors.js';

interface SyncOptions {
  project?: string;
  branch?: string;
  commit?: string;
  findings?: string;
  dryRun?: boolean;
}

/** Default findings file path */
const DEFAULT_FINDINGS_PATH = '.securitychecks/results.json';

interface ScanResults {
  targetPath: string;
  runAt: string;
  duration: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    waived: number;
    byPriority: { P0: number; P1: number; P2: number };
  };
  results: Array<{
    invariantId: string;
    findings: Finding[];
  }>;
}

/**
 * Load scan results from file
 */
async function loadResults(findingsPath: string): Promise<ScanResults> {
  const fullPath = resolve(findingsPath);

  if (!existsSync(fullPath)) {
    throw new CLIError(
      ErrorCodes.ARTIFACT_NOT_FOUND,
      `Results file not found: ${fullPath}`
    );
  }

  try {
    const content = await readFile(fullPath, 'utf-8');
    return JSON.parse(content) as ScanResults;
  } catch (error) {
    throw new CLIError(
      ErrorCodes.ARTIFACT_INVALID,
      `Failed to parse results: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Try to detect git branch and commit
 */
async function detectGitInfo(targetPath: string): Promise<{ branch?: string; commit?: string }> {
  try {
    const { execSync } = await import('node:child_process');

    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: targetPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const commit = execSync('git rev-parse HEAD', {
      cwd: targetPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return { branch, commit };
  } catch {
    return {};
  }
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  try {
    const config = await loadCloudConfig();
    const apiKey = getApiKey(options.project) || config.apiKey;

    if (!apiKey) {
      throw new CLIError(
        ErrorCodes.CLOUD_AUTH_FAILED,
        'Not logged in. Run `scheck login` first.'
      );
    }

    const projectSlug = getProject(options.project) || config.project;

    if (!projectSlug) {
      throw new CLIError(
        ErrorCodes.CLI_MISSING_ARGUMENT,
        'No project specified. Use --project or set default with `scheck config --set project=<slug>`'
      );
    }

    // Load results
    const findingsPath = options.findings || DEFAULT_FINDINGS_PATH;
    console.log(pc.dim(`Loading results from ${findingsPath}...`));

    const results = await loadResults(findingsPath);
    const allFindings = results.results.flatMap((r) => r.findings);

    // Detect git info
    const gitInfo = await detectGitInfo(results.targetPath);
    const branch = options.branch || gitInfo.branch;
    const commitSha = options.commit || gitInfo.commit;

    console.log('');
    console.log(pc.bold('Sync Summary:'));
    console.log(`  Project:   ${projectSlug}`);
    console.log(`  Branch:    ${branch || '(none)'}`);
    console.log(`  Commit:    ${commitSha ? commitSha.substring(0, 8) : '(none)'}`);
    console.log(`  Findings:  ${allFindings.length}`);
    console.log(`  P0: ${results.summary.byPriority.P0}, P1: ${results.summary.byPriority.P1}, P2: ${results.summary.byPriority.P2}`);
    console.log('');

    if (options.dryRun) {
      console.log(pc.yellow('Dry run - no changes made.\n'));
      return;
    }

    const apiUrl = getApiUrl(config);
    const client = createCloudClient(apiUrl, apiKey);

    // Create scan
    console.log(pc.dim('Creating scan...'));
    const scan = await client.createScan({
      projectSlug,
      branch,
      commitSha,
    });

    console.log(pc.dim(`Scan created: ${scan.id}`));

    // Submit findings
    if (allFindings.length > 0) {
      console.log(pc.dim('Submitting findings...'));
      const submitResult = await client.submitFindings(scan.id, allFindings);
      console.log(pc.dim(`Created: ${submitResult.created}, Updated: ${submitResult.updated}`));
    }

    // Mark scan complete
    console.log(pc.dim('Completing scan...'));
    await client.updateScan(scan.id, {
      status: 'COMPLETED',
      summary: {
        p0: results.summary.byPriority.P0,
        p1: results.summary.byPriority.P1,
        p2: results.summary.byPriority.P2,
      },
      duration: results.duration,
    });

    // Update last sync timestamp
    await updateCloudConfig({ lastSync: new Date().toISOString() });

    console.log(pc.green('\n✓ Sync complete!\n'));
    console.log(pc.dim(`View at: https://securitychecks.ai/dashboard/scans/${scan.id}`));
    console.log('');
  } catch (error) {
    if (error instanceof CLIError) {
      console.error(pc.red(`\n✗ ${error.message}\n`));
      const remediation = error.getRemediation();
      if (remediation) {
        console.error(pc.yellow('How to fix:'));
        for (const line of remediation.split('\n')) {
          console.error(pc.dim(`  ${line}`));
        }
        console.error('');
      }
    } else {
      console.error(pc.red(`\n✗ Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    }
    process.exit(1);
  }
}
