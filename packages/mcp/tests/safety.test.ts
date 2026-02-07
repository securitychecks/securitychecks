import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  formatEvidenceForMcp,
  parseAllowedRootsFromEnv,
  resolveAndValidateTargetPath,
} from '../src/safety.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scheck-mcp-'));
}

describe('parseAllowedRootsFromEnv', () => {
  test('fails closed when env not set and no git repo', () => {
    const cwd = '/tmp/example';
    expect(() => parseAllowedRootsFromEnv({}, cwd)).toThrow(
      /no allowed roots are configured and no git repository was detected/i
    );
  });

  test('defaults to git root when available', () => {
    try {
      execSync('git --version', { stdio: 'ignore' });
    } catch {
      return;
    }

    const repo = makeTempDir();
    execSync('git init', { cwd: repo, stdio: 'ignore' });

    const nested = path.join(repo, 'nested');
    fs.mkdirSync(nested);

    const roots = parseAllowedRootsFromEnv({}, nested);
    expect(roots).toEqual([path.resolve(repo)]);
  });

  test('parses comma-separated roots', () => {
    const cwd = '/tmp/example';
    const roots = parseAllowedRootsFromEnv(
      { SCHECK_MCP_ALLOWED_ROOTS: 'a,b/../c, /abs/root ' },
      cwd
    );
    expect(roots).toEqual([
      path.resolve(cwd, 'a'),
      path.resolve(cwd, 'c'),
      path.resolve(cwd, '/abs/root'),
    ]);
  });

});

describe('resolveAndValidateTargetPath', () => {
  test('allows scanning within allowed root', () => {
    const root = makeTempDir();
    const projectDir = path.join(root, 'project');
    fs.mkdirSync(projectDir);

    const resolved = resolveAndValidateTargetPath(projectDir, {
      cwd: root,
      allowedRoots: [root],
    });

    expect(resolved).toBe(path.resolve(projectDir));
  });

  test('rejects scanning outside allowed root', () => {
    const root = makeTempDir();
    const outside = makeTempDir();

    expect(() =>
      resolveAndValidateTargetPath(outside, {
        cwd: root,
        allowedRoots: [root],
      })
    ).toThrow(/Refusing to scan outside allowed roots/);
  });

  test('rejects non-existent target', () => {
    const root = makeTempDir();
    const missing = path.join(root, 'does-not-exist');

    expect(() =>
      resolveAndValidateTargetPath(missing, {
        cwd: root,
        allowedRoots: [root],
      })
    ).toThrow(/Target path does not exist/);
  });
});

describe('formatEvidenceForMcp', () => {
  test('omits context when includeContext is false', () => {
    const evidence = [{ file: 'a.ts', line: 1, context: 'secret' }];
    expect(formatEvidenceForMcp(evidence, false)).toEqual([{ file: 'a.ts', line: 1 }]);
  });

  test('includes context when includeContext is true', () => {
    const evidence = [{ file: 'a.ts', line: 1, context: 'snippet' }];
    expect(formatEvidenceForMcp(evidence, true)).toEqual(evidence);
  });
});
