#!/usr/bin/env npx tsx
/**
 * Benchmark Diff
 *
 * Compares two golden benchmark review files and reports:
 * - New findings (regressions)
 * - Removed findings (improvements)
 * - Per-invariant accuracy delta
 * - Overall accuracy change
 *
 * Usage:
 *   npx tsx scripts/benchmark-diff.ts <before.json> <after.json>
 *   npx tsx scripts/benchmark-diff.ts --latest-two
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

interface GoldenFinding {
  id: string;
  repo: string;
  commitHash: string;
  invariantId: string;
  severity: string;
  message: string;
  file: string;
  line: number;
  symbol?: string;
  context?: string;
  verdict?: 'true_positive' | 'false_positive' | 'uncertain';
  reviewNotes?: string;
  reviewedAt?: string;
}

interface ReviewFile {
  meta: {
    createdAt: string;
    totalFindings: number;
    reviewed: number;
    truePositives: number;
    falsePositives: number;
    uncertain: number;
  };
  findings: GoldenFinding[];
}

interface AccuracyStats {
  total: number;
  truePositives: number;
  falsePositives: number;
  accuracy: number;
}

function calculateStats(findings: GoldenFinding[]): AccuracyStats {
  const reviewed = findings.filter((f) => f.verdict);
  const tp = reviewed.filter((f) => f.verdict === 'true_positive').length;
  const fp = reviewed.filter((f) => f.verdict === 'false_positive').length;
  const accuracy = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;

  return { total: findings.length, truePositives: tp, falsePositives: fp, accuracy };
}

function getLatestReviewFiles(): [string, string] | null {
  const baseDir = join(process.cwd(), 'data/golden-benchmark');
  const files = readdirSync(baseDir)
    .filter((name) => name.match(/golden-benchmark-\d+-review\.json$/))
    .map((name) => {
      const match = name.match(/golden-benchmark-(\d+)-review\.json/);
      const timestamp = match ? Number(match[1]) : 0;
      return { name: join(baseDir, name), timestamp };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  if (files.length < 2) return null;
  return [files[files.length - 2]!.name, files[files.length - 1]!.name];
}

function formatDelta(before: number, after: number): string {
  const delta = after - before;
  if (delta === 0) return '=';
  return delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
}

export function runBenchmarkDiff(args: string[]): number {
  let beforeFile: string;
  let afterFile: string;

  if (args.includes('--latest-two')) {
    const files = getLatestReviewFiles();
    if (!files) {
      console.error('Need at least 2 review files in data/golden-benchmark/');
      return 1;
    }
    [beforeFile, afterFile] = files;
  } else if (args.length >= 2) {
    beforeFile = args[0]!;
    afterFile = args[1]!;
  } else {
    console.error('Usage: npx tsx scripts/benchmark-diff.ts <before.json> <after.json>');
    console.error('       npx tsx scripts/benchmark-diff.ts --latest-two');
    return 1;
  }

  let before: ReviewFile;
  let after: ReviewFile;

  try {
    before = JSON.parse(readFileSync(beforeFile, 'utf-8'));
    after = JSON.parse(readFileSync(afterFile, 'utf-8'));
  } catch (error) {
    console.error(`Failed to load files: ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  BENCHMARK DIFF REPORT`);
  console.log(`${'═'.repeat(70)}\n`);

  console.log(`Before: ${beforeFile}`);
  console.log(`After:  ${afterFile}\n`);

  // Overall comparison
  const beforeStats = calculateStats(before.findings);
  const afterStats = calculateStats(after.findings);

  console.log(`${'─'.repeat(70)}`);
  console.log(`Overall Comparison:`);
  console.log(`${'─'.repeat(70)}\n`);

  console.log(`  | Metric          | Before  | After   | Delta   |`);
  console.log(`  |-----------------|---------|---------|---------|`);
  console.log(
    `  | Total findings  | ${String(beforeStats.total).padStart(7)} | ${String(afterStats.total).padStart(7)} | ${formatDelta(beforeStats.total, afterStats.total).padStart(7)} |`
  );
  console.log(
    `  | True positives  | ${String(beforeStats.truePositives).padStart(7)} | ${String(afterStats.truePositives).padStart(7)} | ${formatDelta(beforeStats.truePositives, afterStats.truePositives).padStart(7)} |`
  );
  console.log(
    `  | False positives | ${String(beforeStats.falsePositives).padStart(7)} | ${String(afterStats.falsePositives).padStart(7)} | ${formatDelta(beforeStats.falsePositives, afterStats.falsePositives).padStart(7)} |`
  );
  console.log(
    `  | Accuracy        | ${(beforeStats.accuracy.toFixed(1) + '%').padStart(7)} | ${(afterStats.accuracy.toFixed(1) + '%').padStart(7)} | ${(formatDelta(beforeStats.accuracy, afterStats.accuracy) + '%').padStart(7)} |`
  );

  // Per-invariant comparison
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Per-Invariant Accuracy Delta:`);
  console.log(`${'─'.repeat(70)}\n`);

  const beforeByInvariant = new Map<string, GoldenFinding[]>();
  const afterByInvariant = new Map<string, GoldenFinding[]>();

  for (const f of before.findings) {
    const list = beforeByInvariant.get(f.invariantId) || [];
    list.push(f);
    beforeByInvariant.set(f.invariantId, list);
  }
  for (const f of after.findings) {
    const list = afterByInvariant.get(f.invariantId) || [];
    list.push(f);
    afterByInvariant.set(f.invariantId, list);
  }

  const allInvariants = new Set([
    ...beforeByInvariant.keys(),
    ...afterByInvariant.keys(),
  ]);

  const invariantDeltas: Array<{
    id: string;
    beforeAcc: number;
    afterAcc: number;
    delta: number;
    beforeCount: number;
    afterCount: number;
  }> = [];

  for (const id of allInvariants) {
    const bFindings = beforeByInvariant.get(id) || [];
    const aFindings = afterByInvariant.get(id) || [];
    const bStats = calculateStats(bFindings);
    const aStats = calculateStats(aFindings);

    invariantDeltas.push({
      id,
      beforeAcc: bStats.accuracy,
      afterAcc: aStats.accuracy,
      delta: aStats.accuracy - bStats.accuracy,
      beforeCount: bStats.total,
      afterCount: aStats.total,
    });
  }

  // Sort by delta (regressions first)
  invariantDeltas.sort((a, b) => a.delta - b.delta);

  for (const item of invariantDeltas) {
    const deltaStr = item.delta === 0 ? '  =' : item.delta > 0 ? ` +${item.delta.toFixed(1)}%` : ` ${item.delta.toFixed(1)}%`;
    const indicator = item.delta < -5 ? '⬇' : item.delta > 5 ? '⬆' : ' ';
    console.log(
      `  ${indicator} ${item.id.padEnd(45)} ${item.beforeAcc.toFixed(1).padStart(6)}% → ${item.afterAcc.toFixed(1).padStart(6)}% (${deltaStr})`
    );
  }

  // New findings (regressions) - findings in after but not in before
  const beforeIds = new Set(before.findings.map((f) => `${f.invariantId}:${f.file}:${f.line}`));
  const afterIds = new Set(after.findings.map((f) => `${f.invariantId}:${f.file}:${f.line}`));

  const newFindings = after.findings.filter(
    (f) => !beforeIds.has(`${f.invariantId}:${f.file}:${f.line}`)
  );
  const removedFindings = before.findings.filter(
    (f) => !afterIds.has(`${f.invariantId}:${f.file}:${f.line}`)
  );

  if (newFindings.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`New Findings (${newFindings.length}):`);
    console.log(`${'─'.repeat(70)}\n`);

    for (const f of newFindings.slice(0, 20)) {
      console.log(`  + ${f.invariantId} in ${f.file}:${f.line}`);
    }
    if (newFindings.length > 20) {
      console.log(`  ... and ${newFindings.length - 20} more`);
    }
  }

  if (removedFindings.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Removed Findings (${removedFindings.length}):`);
    console.log(`${'─'.repeat(70)}\n`);

    for (const f of removedFindings.slice(0, 20)) {
      console.log(`  - ${f.invariantId} in ${f.file}:${f.line}`);
    }
    if (removedFindings.length > 20) {
      console.log(`  ... and ${removedFindings.length - 20} more`);
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${'═'.repeat(70)}\n`);

  const regressions = invariantDeltas.filter((d) => d.delta < -5);
  const improvements = invariantDeltas.filter((d) => d.delta > 5);

  if (regressions.length > 0) {
    console.log(`  ⬇ ${regressions.length} invariant(s) regressed (>5% accuracy drop):`);
    for (const r of regressions) {
      console.log(`    - ${r.id}: ${r.beforeAcc.toFixed(1)}% → ${r.afterAcc.toFixed(1)}%`);
    }
  }

  if (improvements.length > 0) {
    console.log(`  ⬆ ${improvements.length} invariant(s) improved (>5% accuracy gain):`);
    for (const r of improvements) {
      console.log(`    + ${r.id}: ${r.beforeAcc.toFixed(1)}% → ${r.afterAcc.toFixed(1)}%`);
    }
  }

  console.log(`\n  New findings: +${newFindings.length}`);
  console.log(`  Removed findings: -${removedFindings.length}`);
  console.log(
    `  Overall accuracy: ${beforeStats.accuracy.toFixed(1)}% → ${afterStats.accuracy.toFixed(1)}% (${formatDelta(beforeStats.accuracy, afterStats.accuracy)}%)`
  );
  console.log(`\n${'═'.repeat(70)}\n`);

  // Exit with error if regressions detected
  if (regressions.length > 0) {
    return 1;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = runBenchmarkDiff(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
