/**
 * Tests for partitions module - workspace discovery
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverPartitions } from '../src/partitions.js';

describe('partitions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-partitions-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('discoverPartitions', () => {
    describe('single project structure', () => {
      it('discovers root partition with package.json', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(1);
        expect(partitions[0]?.kind).toBe('root');
        expect(partitions[0]?.root).toBe(tempDir);
        expect(partitions[0]?.relativePath).toBe('');
        expect(partitions[0]?.packageJsonPath).toContain('package.json');
      });

      it('discovers root partition with tsconfig.json', async () => {
        writeFileSync(join(tempDir, 'tsconfig.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(1);
        expect(partitions[0]?.kind).toBe('root');
        expect(partitions[0]?.tsconfigPath).toContain('tsconfig.json');
      });

      it('discovers root partition with both files', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        writeFileSync(join(tempDir, 'tsconfig.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(1);
        expect(partitions[0]?.packageJsonPath).toBeDefined();
        expect(partitions[0]?.tsconfigPath).toBeDefined();
      });

      it('handles root with no config files', async () => {
        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(1);
        expect(partitions[0]?.kind).toBe('root');
        expect(partitions[0]?.packageJsonPath).toBeUndefined();
        expect(partitions[0]?.tsconfigPath).toBeUndefined();
      });
    });

    describe('monorepo with apps/ directory', () => {
      it('discovers app partitions', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'web', 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'api'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'api', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(3);
        expect(partitions[0]?.kind).toBe('workspace');
        expect(partitions.filter((p) => p.kind === 'app')).toHaveLength(2);
      });

      it('identifies root as workspace when apps exist', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'web', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions[0]?.kind).toBe('workspace');
      });

      it('sets correct relativePath for app partitions', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'web', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);
        const webApp = partitions.find((p) => p.kind === 'app');

        expect(webApp?.relativePath).toBe('apps/web');
      });

      it('skips apps without package.json or tsconfig.json', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'web', 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'empty'), { recursive: true });
        // 'empty' has no config files

        const partitions = await discoverPartitions(tempDir);

        const apps = partitions.filter((p) => p.kind === 'app');
        expect(apps).toHaveLength(1);
        expect(apps[0]?.relativePath).toBe('apps/web');
      });

      it('discovers app with only tsconfig.json', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'lib'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'lib', 'tsconfig.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        const lib = partitions.find((p) => p.relativePath === 'apps/lib');
        expect(lib).toBeDefined();
        expect(lib?.tsconfigPath).toBeDefined();
        expect(lib?.packageJsonPath).toBeUndefined();
      });
    });

    describe('monorepo with packages/ directory', () => {
      it('discovers package partitions', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'packages', 'ui'), { recursive: true });
        writeFileSync(join(tempDir, 'packages', 'ui', 'package.json'), '{}');
        mkdirSync(join(tempDir, 'packages', 'utils'), { recursive: true });
        writeFileSync(join(tempDir, 'packages', 'utils', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(3);
        expect(partitions[0]?.kind).toBe('workspace');
        expect(partitions.filter((p) => p.kind === 'package')).toHaveLength(2);
      });

      it('sets correct relativePath for package partitions', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'packages', 'core'), { recursive: true });
        writeFileSync(join(tempDir, 'packages', 'core', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);
        const corePackage = partitions.find((p) => p.kind === 'package');

        expect(corePackage?.relativePath).toBe('packages/core');
      });
    });

    describe('monorepo with both apps/ and packages/', () => {
      it('discovers all partitions', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'web', 'package.json'), '{}');
        mkdirSync(join(tempDir, 'packages', 'ui'), { recursive: true });
        writeFileSync(join(tempDir, 'packages', 'ui', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(3);
        expect(partitions[0]?.kind).toBe('workspace');
        expect(partitions.filter((p) => p.kind === 'app')).toHaveLength(1);
        expect(partitions.filter((p) => p.kind === 'package')).toHaveLength(1);
      });

      it('orders partitions: root, apps, packages', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'web', 'package.json'), '{}');
        mkdirSync(join(tempDir, 'packages', 'ui'), { recursive: true });
        writeFileSync(join(tempDir, 'packages', 'ui', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions[0]?.kind).toBe('workspace');
        expect(partitions[1]?.kind).toBe('app');
        expect(partitions[2]?.kind).toBe('package');
      });

      it('sorts apps and packages alphabetically', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'zebra'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'zebra', 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'alpha'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'alpha', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);
        const apps = partitions.filter((p) => p.kind === 'app');

        expect(apps[0]?.relativePath).toBe('apps/alpha');
        expect(apps[1]?.relativePath).toBe('apps/zebra');
      });
    });

    describe('edge cases', () => {
      it('skips hidden directories', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', '.hidden'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', '.hidden', 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'visible'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'visible', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        const apps = partitions.filter((p) => p.kind === 'app');
        expect(apps).toHaveLength(1);
        expect(apps[0]?.relativePath).toBe('apps/visible');
      });

      it('handles missing apps/ directory', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'packages', 'core'), { recursive: true });
        writeFileSync(join(tempDir, 'packages', 'core', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(2);
        expect(partitions.filter((p) => p.kind === 'app')).toHaveLength(0);
        expect(partitions.filter((p) => p.kind === 'package')).toHaveLength(1);
      });

      it('handles missing packages/ directory', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
        writeFileSync(join(tempDir, 'apps', 'web', 'package.json'), '{}');

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(2);
        expect(partitions.filter((p) => p.kind === 'app')).toHaveLength(1);
        expect(partitions.filter((p) => p.kind === 'package')).toHaveLength(0);
      });

      it('handles empty apps/ directory', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'apps'), { recursive: true });

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(1);
        expect(partitions[0]?.kind).toBe('root');
      });

      it('handles empty packages/ directory', async () => {
        writeFileSync(join(tempDir, 'package.json'), '{}');
        mkdirSync(join(tempDir, 'packages'), { recursive: true });

        const partitions = await discoverPartitions(tempDir);

        expect(partitions).toHaveLength(1);
        expect(partitions[0]?.kind).toBe('root');
      });

      it('handles non-existent target path gracefully', async () => {
        const nonExistentPath = join(tempDir, 'does-not-exist');

        const partitions = await discoverPartitions(nonExistentPath);

        // Should still return root partition
        expect(partitions).toHaveLength(1);
        expect(partitions[0]?.kind).toBe('root');
      });
    });
  });
});
