/**
 * scc - SecurityChecks Collector CLI
 *
 * Extracts code artifacts for analysis. No opinions, no policy.
 * "The collector emits facts. Products interpret facts."
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

import { collect, type CollectorProfile, PROFILES } from './index.js';

const program = new Command();

/** Default output path for artifacts */
const DEFAULT_OUTPUT_PATH = '.securitychecks/artifacts.json';

/** Format duration for human-readable output */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

program
  .name('scc')
  .description('SecurityChecks Collector - Extract code artifacts')
  .version('0.1.0-beta.1');

program
  .command('collect')
  .description('Collect code artifacts from target codebase')
  .option('-p, --profile <profile>', 'Extraction profile (securitychecks, trackstack, all)', 'securitychecks')
  .option('-o, --out <file>', `Output file path (use --out=- for stdout)`)
  .option('-t, --target <path>', 'Target directory to analyze', process.cwd())
  .option('-f, --format <format>', 'Output format: json or ndjson', 'json')
  .option('--pretty', 'Pretty-print JSON output', false)
  .option('--quiet', 'Suppress progress messages', false)
  .action(async (options: {
    profile: string;
    out?: string;
    target: string;
    format: string;
    pretty: boolean;
    quiet: boolean;
  }) => {
    const startTime = Date.now();

    try {
      const profile = options.profile as CollectorProfile;

      if (!PROFILES[profile]) {
        console.error(pc.red(`Unknown profile: ${options.profile}`));
        console.error(`Available profiles: ${Object.keys(PROFILES).join(', ')}`);
        process.exit(1);
      }

      if (options.format !== 'json' && options.format !== 'ndjson') {
        console.error(pc.red(`Unknown format: ${options.format}`));
        console.error('Available formats: json, ndjson');
        process.exit(1);
      }

      const targetPath = resolve(options.target);

      if (!options.quiet) {
        console.error(pc.dim(`Collecting artifacts from ${targetPath}...`));
        console.error(pc.dim(`Profile: ${profile}`));
      }

      const artifact = await collect({
        targetPath,
        profile,
      });

      const duration = Date.now() - startTime;

      // Format output
      let output: string;
      if (options.format === 'ndjson') {
        // NDJSON: each array item on its own line for streaming
	        const lines: string[] = [];
	        lines.push(JSON.stringify({ _meta: { version: artifact.version, profile: artifact.profile, extractedAt: artifact.extractedAt, codebase: artifact.codebase } }));
	        for (const service of artifact.services) {
	          lines.push(JSON.stringify({ _type: 'service', ...service }));
	        }
	        for (const call of artifact.authzCalls ?? []) {
	          lines.push(JSON.stringify({ _type: 'authzCall', ...call }));
	        }
	        for (const op of artifact.cacheOperations ?? []) {
	          lines.push(JSON.stringify({ _type: 'cacheOperation', ...op }));
	        }
	        for (const scope of artifact.transactionScopes ?? []) {
	          lines.push(JSON.stringify({ _type: 'transactionScope', ...scope }));
	        }
	        for (const handler of artifact.webhookHandlers ?? []) {
	          lines.push(JSON.stringify({ _type: 'webhookHandler', ...handler }));
	        }
	        for (const job of artifact.jobHandlers ?? []) {
	          lines.push(JSON.stringify({ _type: 'jobHandler', ...job }));
	        }
	        for (const test of artifact.tests ?? []) {
	          lines.push(JSON.stringify({ _type: 'test', ...test }));
	        }
        output = lines.join('\n') + '\n';
      } else {
        output = options.pretty
          ? JSON.stringify(artifact, null, 2)
          : JSON.stringify(artifact);
      }

      // Determine output destination
      const outputToStdout = options.out === '-' || options.out === undefined;
      const outputPath = outputToStdout ? null : resolve(options.out ?? DEFAULT_OUTPUT_PATH);

      if (outputPath) {
        // Create directory if needed
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output, 'utf-8');

        if (!options.quiet) {
          console.error(pc.green(`✓ Artifacts written to ${outputPath}`));
          console.error(pc.dim(`  Files scanned: ${artifact.codebase.filesScanned}`));
          console.error(pc.dim(`  Services: ${artifact.services.length}`));
          console.error(pc.dim(`  Duration: ${formatDuration(duration)}`));
        }
      } else {
        console.log(output);
        if (!options.quiet) {
          console.error(pc.dim(`Collected in ${formatDuration(duration)}`));
        }
      }
    } catch (error) {
      console.error(pc.red('Collection failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('profiles')
  .description('List available extraction profiles')
  .action(() => {
    console.log(pc.bold('Available profiles:\n'));

    for (const [name, profile] of Object.entries(PROFILES)) {
      console.log(pc.cyan(`  ${name}`));
      console.log(pc.dim(`    Extractors: ${profile.extractors.join(', ')}`));
      console.log();
    }
  });

program.parse();
