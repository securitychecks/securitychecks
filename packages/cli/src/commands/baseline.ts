/**
 * Baseline Command
 *
 * Manages the baseline of known issues that should not fail CI.
 *
 * Usage:
 *   scheck baseline --update    # Add current findings to baseline
 *   scheck baseline --show      # Show current baseline
 *   scheck baseline --prune     # Remove stale entries
 */

import pc from 'picocolors';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { audit } from '../audit.js';
import {
  loadBaseline,
  saveBaseline,
  addToBaseline,
  pruneBaseline,
  getBaselinePath,
} from '../baseline/index.js';
import { generateFindingId } from '../findings/index.js';

export interface BaselineOptions {
  path?: string;
  update?: boolean;
  show?: boolean;
  prune?: boolean;
  pruneDays?: string;
  notes?: string;
  yes?: boolean;
}

export async function baselineCommand(options: BaselineOptions): Promise<void> {
  const targetPath = resolve(options.path ?? process.cwd());

  if (options.show) {
    await showBaseline(targetPath);
  } else if (options.update) {
    await updateBaseline(targetPath, options.notes, options.yes ?? false);
  } else if (options.prune) {
    await pruneBaselineEntries(targetPath, parseInt(options.pruneDays ?? '90', 10));
  } else {
    // Default: show summary
    await showBaseline(targetPath);
  }
}

async function showBaseline(targetPath: string): Promise<void> {
  const baseline = await loadBaseline(targetPath);
  const entries = Object.values(baseline.entries);

  if (entries.length === 0) {
    console.log(pc.dim('No baseline entries.'));
    console.log(pc.dim(`Run ${pc.bold('scheck baseline --update')} to add current findings.`));
    return;
  }

  console.log(pc.bold(`Baseline: ${entries.length} entries`));
  console.log(pc.dim(`Schema version: ${baseline.schemaVersion}`));
  console.log(pc.dim(`Last updated: ${baseline.updatedAt}`));
  console.log(pc.dim(`Path: ${getBaselinePath(targetPath)}`));
  console.log();

  // Group by invariant
  const byInvariant = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = byInvariant.get(entry.invariantId) ?? [];
    list.push(entry);
    byInvariant.set(entry.invariantId, list);
  }

  for (const [invariantId, invariantEntries] of byInvariant) {
    console.log(pc.cyan(`${invariantId} (${invariantEntries.length})`));
    for (const entry of invariantEntries.slice(0, 5)) {
      const symbol = entry.symbol ? `:${entry.symbol}` : '';
      console.log(`  ${pc.dim('•')} ${entry.file}${symbol}`);
      if (entry.notes) {
        console.log(`    ${pc.dim(entry.notes)}`);
      }
    }
    if (invariantEntries.length > 5) {
      console.log(pc.dim(`    ... and ${invariantEntries.length - 5} more`));
    }
  }
}

async function updateBaseline(targetPath: string, notes?: string, skipConfirmation = false): Promise<void> {
  console.log(pc.dim('Running audit to collect current findings...'));

  // Run audit to get current findings
  const result = await audit({
    targetPath,
  });

  const baseline = await loadBaseline(targetPath);
  const findings = result.results.flatMap((r) => r.findings);

  if (findings.length === 0) {
    console.log(pc.green('No findings to baseline.'));
    return;
  }

  // Check which findings are new (not already in baseline)
  const newFindings = findings.filter((f) => {
    const findingId = generateFindingId(f);
    return !(findingId in baseline.entries);
  });

  if (newFindings.length === 0) {
    console.log(pc.green('All findings are already in the baseline.'));
    return;
  }

  // Show what will be added
  console.log();
  console.log(pc.yellow(`About to add ${newFindings.length} finding(s) to the baseline:`));
  console.log();

  // Group by invariant for display
  const byInvariant = new Map<string, typeof newFindings>();
  for (const finding of newFindings) {
    const list = byInvariant.get(finding.invariantId) ?? [];
    list.push(finding);
    byInvariant.set(finding.invariantId, list);
  }

  for (const [invariantId, invariantFindings] of byInvariant) {
    console.log(pc.cyan(`  ${invariantId} (${invariantFindings.length})`));
    for (const finding of invariantFindings.slice(0, 3)) {
      const evidence = finding.evidence[0];
      const location = evidence ? `${evidence.file}:${evidence.line}` : 'unknown';
      console.log(pc.dim(`    • ${location}`));
    }
    if (invariantFindings.length > 3) {
      console.log(pc.dim(`    ... and ${invariantFindings.length - 3} more`));
    }
  }
  console.log();

  // Ask for confirmation unless --yes
  if (!skipConfirmation && !isNonInteractive()) {
    const confirmed = await confirm(
      `Add ${newFindings.length} finding(s) to baseline? This will suppress them in CI. [y/N] `
    );
    if (!confirmed) {
      console.log(pc.dim('Cancelled.'));
      return;
    }
  }

  const added = addToBaseline(baseline, findings, notes);
  await saveBaseline(targetPath, baseline);

  console.log(pc.green(`✓ Baseline updated`));
  console.log(`  ${pc.bold(added.toString())} new entries added`);
  console.log(`  ${pc.dim(Object.keys(baseline.entries).length.toString())} total entries`);
  console.log(`  ${pc.dim(`Path: ${getBaselinePath(targetPath)}`)}`);
}

/**
 * Check if running in a non-interactive environment (CI, piped input, etc.)
 */
function isNonInteractive(): boolean {
  return !process.stdin.isTTY || !!process.env['CI'];
}

/**
 * Prompt the user for confirmation.
 */
async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function pruneBaselineEntries(targetPath: string, staleDays: number): Promise<void> {
  const baseline = await loadBaseline(targetPath);
  const beforeCount = Object.keys(baseline.entries).length;

  const removed = pruneBaseline(baseline, staleDays);

  if (removed === 0) {
    console.log(pc.dim(`No entries older than ${staleDays} days.`));
    return;
  }

  await saveBaseline(targetPath, baseline);

  console.log(pc.green(`✓ Pruned ${removed} stale entries`));
  console.log(`  ${pc.dim(`${beforeCount} → ${Object.keys(baseline.entries).length} entries`)}`);
}
