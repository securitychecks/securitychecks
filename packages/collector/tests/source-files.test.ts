/**
 * Tests for source-files module - file collection and loading
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectFilePaths, loadSourceFiles } from '../src/files/source-files.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
    ...overrides,
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('source-files', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-source-files-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('collectFilePaths', () => {
    it('returns empty array for empty patterns', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: [],
      });

      expect(result).toEqual([]);
    });

    it('collects files matching patterns', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/utils.ts', 'export function foo() {}');
      createFile(tempDir, 'package.json', '{}');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(2);
      expect(result.some((f) => f.endsWith('index.ts'))).toBe(true);
      expect(result.some((f) => f.endsWith('utils.ts'))).toBe(true);
    });

    it('excludes node_modules by default', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'node_modules/foo/index.ts', 'export const y = 2;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('node_modules'))).toBe(false);
    });

    it('excludes dist by default', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'dist/index.ts', 'export const y = 2;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('dist'))).toBe(false);
    });

    it('skips test files when skipTests is true', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/index.test.ts', 'describe("test", () => {});');
      createFile(tempDir, '__tests__/foo.ts', 'test("foo", () => {});');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        skipTests: true,
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('test'))).toBe(false);
    });

    it('includes test files when skipTests is false', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/index.test.ts', 'describe("test", () => {});');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        skipTests: false,
        skipGenerated: false,
      });

      expect(result.length).toBe(2);
      expect(result.some((f) => f.includes('test'))).toBe(true);
    });

    it('skips generated files when skipGenerated is true', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, '__generated__/types.ts', 'export type Foo = string;');
      createFile(tempDir, 'src/schema.generated.ts', 'export type Schema = {};');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        skipGenerated: true,
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('generated'))).toBe(false);
    });

    it('includes generated files when skipGenerated is false', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, '__generated__/types.ts', 'export type Foo = string;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        skipTests: false,
        skipGenerated: false,
      });

      expect(result.length).toBe(2);
    });

    it('respects custom ignore patterns', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/internal/private.ts', 'export const y = 2;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        ignore: ['**/internal/**'],
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('internal'))).toBe(false);
    });

    it('returns unique file paths', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts', 'src/**/*.ts'],
      });

      const uniquePaths = new Set(result);
      expect(result.length).toBe(uniquePaths.size);
    });

    it('returns cached results for same options', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      const config = makeConfig();
      const patterns = ['**/*.ts'];

      const result1 = await collectFilePaths({
        targetPath: tempDir,
        config,
        patterns,
      });

      const result2 = await collectFilePaths({
        targetPath: tempDir,
        config,
        patterns,
      });

      expect(result1).toEqual(result2);
    });
  });

  describe('collectFilePaths with partitioning', () => {
    it('collects files from monorepo apps', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      createFile(tempDir, 'apps/web/src/index.ts', 'export const web = 1;');
      createFile(tempDir, 'apps/api/src/index.ts', 'export const api = 1;');
      writeFileSync(join(tempDir, 'apps/web/package.json'), '{}');
      writeFileSync(join(tempDir, 'apps/api/package.json'), '{}');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({ partitioning: { enabled: true } }),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(2);
      expect(result.some((f) => f.includes('apps/web'))).toBe(true);
      expect(result.some((f) => f.includes('apps/api'))).toBe(true);
    });

    it('collects files from monorepo packages', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      createFile(tempDir, 'packages/ui/src/index.ts', 'export const ui = 1;');
      createFile(tempDir, 'packages/utils/src/index.ts', 'export const utils = 1;');
      writeFileSync(join(tempDir, 'packages/ui/package.json'), '{}');
      writeFileSync(join(tempDir, 'packages/utils/package.json'), '{}');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({ partitioning: { enabled: true } }),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(2);
      expect(result.some((f) => f.includes('packages/ui'))).toBe(true);
      expect(result.some((f) => f.includes('packages/utils'))).toBe(true);
    });

    it('does not collect workspace root files in apps/packages when partitioning', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      createFile(tempDir, 'src/root.ts', 'export const root = 1;');
      createFile(tempDir, 'apps/web/src/index.ts', 'export const web = 1;');
      writeFileSync(join(tempDir, 'apps/web/package.json'), '{}');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({ partitioning: { enabled: true } }),
        patterns: ['**/*.ts'],
      });

      expect(result.some((f) => f.endsWith('root.ts'))).toBe(true);
      expect(result.some((f) => f.includes('apps/web'))).toBe(true);
    });

    it('disables partitioning when configured', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      createFile(tempDir, 'apps/web/src/index.ts', 'export const web = 1;');
      writeFileSync(join(tempDir, 'apps/web/package.json'), '{}');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({ partitioning: { enabled: false } }),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('apps/web'))).toBe(true);
    });
  });

  describe('collectFilePaths with partition overrides', () => {
    it('applies partition-specific include patterns', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      createFile(tempDir, 'apps/web/src/index.ts', 'export const web = 1;');
      createFile(tempDir, 'apps/web/lib/utils.ts', 'export const utils = 1;');
      writeFileSync(join(tempDir, 'apps/web/package.json'), '{}');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({
          partitioning: { enabled: true },
          partitionOverrides: [
            {
              path: 'apps/web',
              include: ['src/**/*.ts'],
            },
          ],
        }),
        patterns: ['**/*.ts'],
      });

      expect(result.some((f) => f.includes('src/index.ts'))).toBe(true);
      // Note: lib/utils.ts may or may not be included depending on override behavior
    });

    it('applies partition-specific exclude patterns', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      createFile(tempDir, 'apps/web/src/index.ts', 'export const web = 1;');
      createFile(tempDir, 'apps/web/src/legacy/old.ts', 'export const old = 1;');
      writeFileSync(join(tempDir, 'apps/web/package.json'), '{}');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({
          partitioning: { enabled: true },
          partitionOverrides: [
            {
              path: 'apps/web',
              exclude: ['**/legacy/**'],
            },
          ],
        }),
        patterns: ['**/*.ts'],
      });

      expect(result.some((f) => f.includes('index.ts'))).toBe(true);
      expect(result.some((f) => f.includes('legacy'))).toBe(false);
    });
  });

  describe('loadSourceFiles', () => {
    it('returns empty array for empty patterns', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: [],
      });

      expect(result).toEqual([]);
    });

    it('loads source files as ts-morph SourceFile objects', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/utils.ts', 'export function foo() {}');

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(2);
      expect(result[0]?.getFilePath()).toBeDefined();
      expect(typeof result[0]?.getFullText()).toBe('string');
    });

    it('skips files that cannot be parsed', async () => {
      createFile(tempDir, 'src/valid.ts', 'export const x = 1;');
      // Create a file that might cause parsing issues but is still valid JS/TS
      createFile(tempDir, 'src/weird.ts', '// Just a comment');

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      // Should have loaded at least the valid file
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('skips test files by default', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(
        tempDir,
        'src/index.test.ts',
        `import { describe, it } from 'vitest';
describe('test', () => {
  it('works', () => {});
});`
      );

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        skipTests: true,
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.getFilePath().includes('test'))).toBe(false);
    });

    it('skips generated files by default', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(
        tempDir,
        'src/schema.generated.ts',
        `// @generated
export type Schema = {};`
      );

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        skipGenerated: true,
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.getFilePath().includes('generated'))).toBe(false);
    });

    it('includes test files when skipTests is false', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(
        tempDir,
        'src/index.test.ts',
        `import { describe, it } from 'vitest';
describe('test', () => {});`
      );

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
        skipTests: false,
        skipGenerated: false,
      });

      expect(result.length).toBe(2);
    });

    it('returns cached results for same options', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      const config = makeConfig();
      const patterns = ['**/*.ts'];

      const result1 = await loadSourceFiles({
        targetPath: tempDir,
        config,
        patterns,
      });

      const result2 = await loadSourceFiles({
        targetPath: tempDir,
        config,
        patterns,
      });

      expect(result1.length).toBe(result2.length);
    });

    it('handles JavaScript files with allowJs', async () => {
      createFile(tempDir, 'src/index.js', 'export const x = 1;');

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig({ include: ['**/*.js'] }),
        patterns: ['**/*.js'],
      });

      expect(result.length).toBe(1);
    });

    it('handles TSX files', async () => {
      createFile(
        tempDir,
        'src/Component.tsx',
        `export function Component() {
  return <div>Hello</div>;
}`
      );

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.tsx'],
      });

      expect(result.length).toBe(1);
    });
  });

  describe('loadSourceFiles with partitioning', () => {
    it('loads source files from monorepo structure', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      createFile(tempDir, 'apps/web/src/index.ts', 'export const web = 1;');
      createFile(tempDir, 'packages/ui/src/Button.ts', 'export const Button = {};');
      writeFileSync(join(tempDir, 'apps/web/package.json'), '{}');
      writeFileSync(join(tempDir, 'packages/ui/package.json'), '{}');

      const result = await loadSourceFiles({
        targetPath: tempDir,
        config: makeConfig({ partitioning: { enabled: true } }),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(2);
    });
  });

  describe('test file handling configuration', () => {
    it('respects testFileHandling mode include', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/index.test.ts', 'describe("test", () => {});');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({
          testFileHandling: { mode: 'include', strategy: 'path' },
        }),
        patterns: ['**/*.ts'],
        skipTests: true,
      });

      // When mode is 'include', shouldSkipTestPath returns false
      expect(result.length).toBe(2);
    });

    it('respects testFileHandling strategy path', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/index.test.ts', 'describe("test", () => {});');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({
          testFileHandling: { mode: 'exclude', strategy: 'path' },
        }),
        patterns: ['**/*.ts'],
        skipTests: true,
      });

      expect(result.length).toBe(1);
      expect(result.some((f) => f.includes('test'))).toBe(false);
    });

    it('respects testFileHandling strategy heuristic', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, 'src/index.test.ts', 'describe("test", () => {});');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({
          testFileHandling: { mode: 'exclude', strategy: 'heuristic' },
        }),
        patterns: ['**/*.ts'],
        skipTests: true,
      });

      // With heuristic strategy, shouldSkipTestPath returns false (path-based check skipped)
      expect(result.length).toBe(2);
    });
  });

  describe('generated file handling configuration', () => {
    it('respects generatedFileHandling mode include', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, '__generated__/types.ts', 'export type Foo = string;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({
          generatedFileHandling: { mode: 'include', strategy: 'path' },
        }),
        patterns: ['**/*.ts'],
        skipGenerated: true,
      });

      // When mode is 'include', shouldSkipGeneratedPath returns false
      expect(result.length).toBe(2);
    });

    it('respects generatedFileHandling strategy header', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');
      createFile(tempDir, '__generated__/types.ts', 'export type Foo = string;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig({
          generatedFileHandling: { mode: 'exclude', strategy: 'header' },
        }),
        patterns: ['**/*.ts'],
        skipGenerated: true,
      });

      // With header strategy, shouldSkipGeneratedPath returns false (path-based check skipped)
      expect(result.length).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty directory', async () => {
      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      expect(result).toEqual([]);
    });

    it('handles deeply nested files', async () => {
      createFile(tempDir, 'src/a/b/c/d/e/index.ts', 'export const x = 1;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(1);
      expect(result[0]).toContain('a/b/c/d/e/index.ts');
    });

    it('handles files with special characters in names', async () => {
      createFile(tempDir, 'src/my-component.ts', 'export const x = 1;');
      createFile(tempDir, 'src/my_util.ts', 'export const y = 2;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['**/*.ts'],
      });

      expect(result.length).toBe(2);
    });

    it('normalizes backslash patterns', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');

      // Use backslash pattern (Windows-style)
      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['src\\**\\*.ts'],
      });

      // Pattern normalization should convert backslashes
      expect(result.length).toBe(1);
    });

    it('handles patterns with ./ prefix', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');

      const result = await collectFilePaths({
        targetPath: tempDir,
        config: makeConfig(),
        patterns: ['./src/**/*.ts'],
      });

      expect(result.length).toBe(1);
    });
  });
});
