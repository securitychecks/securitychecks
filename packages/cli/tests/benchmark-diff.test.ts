import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runBenchmarkDiff } from '../../../scripts/benchmark-diff.js';

describe('benchmark-diff', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-benchmark-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports new findings and accuracy delta', () => {
    const beforeFile = join(tempDir, 'before.json');
    const afterFile = join(tempDir, 'after.json');

    const before = {
      meta: {
        createdAt: '2025-01-01T00:00:00Z',
        totalFindings: 2,
        reviewed: 2,
        truePositives: 1,
        falsePositives: 1,
        uncertain: 0,
      },
      findings: [
        {
          id: '1',
          repo: 'repo',
          commitHash: 'abc',
          invariantId: 'INV.A',
          severity: 'P1',
          message: 'A',
          file: 'src/a.ts',
          line: 10,
          verdict: 'true_positive',
        },
        {
          id: '2',
          repo: 'repo',
          commitHash: 'abc',
          invariantId: 'INV.B',
          severity: 'P1',
          message: 'B',
          file: 'src/b.ts',
          line: 20,
          verdict: 'false_positive',
        },
      ],
    };

    const after = {
      meta: {
        createdAt: '2025-01-02T00:00:00Z',
        totalFindings: 3,
        reviewed: 3,
        truePositives: 2,
        falsePositives: 1,
        uncertain: 0,
      },
      findings: [
        {
          id: '1',
          repo: 'repo',
          commitHash: 'def',
          invariantId: 'INV.A',
          severity: 'P1',
          message: 'A',
          file: 'src/a.ts',
          line: 10,
          verdict: 'true_positive',
        },
        {
          id: '2',
          repo: 'repo',
          commitHash: 'def',
          invariantId: 'INV.B',
          severity: 'P1',
          message: 'B',
          file: 'src/b.ts',
          line: 20,
          verdict: 'true_positive',
        },
        {
          id: '3',
          repo: 'repo',
          commitHash: 'def',
          invariantId: 'INV.C',
          severity: 'P2',
          message: 'C',
          file: 'src/c.ts',
          line: 30,
          verdict: 'false_positive',
        },
      ],
    };

    writeFileSync(beforeFile, JSON.stringify(before, null, 2));
    writeFileSync(afterFile, JSON.stringify(after, null, 2));

    const exitCode = runBenchmarkDiff([beforeFile, afterFile]);

    expect(exitCode).toBe(0);

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('New Findings (1)');
    expect(output).toContain('Overall accuracy: 50.0% → 66.7%');
  });
});
