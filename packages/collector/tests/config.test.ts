/**
 * Tests for config module - configuration loading and merging
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  resolveTargetPath,
  DEFAULT_CONFIG,
  CONFIG_FILE_NAMES,
} from '../src/config.js';

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('DEFAULT_CONFIG', () => {
    it('has required version', () => {
      expect(DEFAULT_CONFIG.version).toBe('1.0');
    });

    it('has include patterns', () => {
      expect(DEFAULT_CONFIG.include).toBeDefined();
      expect(DEFAULT_CONFIG.include!.length).toBeGreaterThan(0);
    });

    it('has exclude patterns', () => {
      expect(DEFAULT_CONFIG.exclude).toBeDefined();
      expect(DEFAULT_CONFIG.exclude!.some((p) => p.includes('node_modules'))).toBe(true);
    });

    it('has testPatterns', () => {
      expect(DEFAULT_CONFIG.testPatterns).toBeDefined();
      expect(DEFAULT_CONFIG.testPatterns!.some((p) => p.includes('.test.'))).toBe(true);
    });

    it('has servicePatterns', () => {
      expect(DEFAULT_CONFIG.servicePatterns).toBeDefined();
      expect(DEFAULT_CONFIG.servicePatterns!.some((p) => p.includes('services'))).toBe(true);
    });

    it('has authzFunctions', () => {
      expect(DEFAULT_CONFIG.authzFunctions).toBeDefined();
      expect(DEFAULT_CONFIG.authzFunctions!.includes('authorize')).toBe(true);
    });

    it('has cachePatterns', () => {
      expect(DEFAULT_CONFIG.cachePatterns).toBeDefined();
      expect(DEFAULT_CONFIG.cachePatterns!.get).toBeDefined();
      expect(DEFAULT_CONFIG.cachePatterns!.set).toBeDefined();
      expect(DEFAULT_CONFIG.cachePatterns!.delete).toBeDefined();
    });

    it('has webhookProviders', () => {
      expect(DEFAULT_CONFIG.webhookProviders).toBeDefined();
      expect(DEFAULT_CONFIG.webhookProviders!.includes('stripe')).toBe(true);
    });

    it('has jobFrameworks', () => {
      expect(DEFAULT_CONFIG.jobFrameworks).toBeDefined();
      expect(DEFAULT_CONFIG.jobFrameworks!.includes('bullmq')).toBe(true);
    });

    it('has testFileHandling', () => {
      expect(DEFAULT_CONFIG.testFileHandling).toBeDefined();
      expect(DEFAULT_CONFIG.testFileHandling!.mode).toBe('exclude');
      expect(DEFAULT_CONFIG.testFileHandling!.strategy).toBe('both');
    });

    it('has partitioning enabled', () => {
      expect(DEFAULT_CONFIG.partitioning).toBeDefined();
      expect(DEFAULT_CONFIG.partitioning!.enabled).toBe(true);
    });

    it('has generatedFileHandling', () => {
      expect(DEFAULT_CONFIG.generatedFileHandling).toBeDefined();
      expect(DEFAULT_CONFIG.generatedFileHandling!.mode).toBe('exclude');
    });

    it('has calibration config', () => {
      expect(DEFAULT_CONFIG.calibration).toBeDefined();
      expect(DEFAULT_CONFIG.calibration!.enabled).toBe(true);
      expect(DEFAULT_CONFIG.calibration!.endpoint).toContain('securitychecks.ai');
    });
  });

  describe('CONFIG_FILE_NAMES', () => {
    it('includes scheck config files', () => {
      expect(CONFIG_FILE_NAMES).toContain('scheck.config.yaml');
      expect(CONFIG_FILE_NAMES).toContain('scheck.config.yml');
      expect(CONFIG_FILE_NAMES).toContain('scheck.config.json');
    });

    it('includes scheckrc files', () => {
      expect(CONFIG_FILE_NAMES).toContain('.scheckrc');
      expect(CONFIG_FILE_NAMES).toContain('.scheckrc.yaml');
      expect(CONFIG_FILE_NAMES).toContain('.scheckrc.json');
    });

    it('includes securitychecks files', () => {
      expect(CONFIG_FILE_NAMES).toContain('securitychecks.config.yaml');
      expect(CONFIG_FILE_NAMES).toContain('securitychecks.config.json');
    });

  });

  describe('loadConfig', () => {
    it('returns DEFAULT_CONFIG when no config file exists', async () => {
      const config = await loadConfig(tempDir);

      expect(config.version).toBe(DEFAULT_CONFIG.version);
      expect(config.include).toEqual(DEFAULT_CONFIG.include);
    });

    it('loads YAML config from scheck.config.yaml', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '2.0'
include:
  - custom/**/*.ts`
      );

      const config = await loadConfig(tempDir);

      expect(config.version).toBe('2.0');
      expect(config.include).toEqual(['custom/**/*.ts']);
    });

    it('loads YAML config from scheck.config.yml', async () => {
      createFile(
        tempDir,
        'scheck.config.yml',
        `version: '1.1'
exclude:
  - temp/**`
      );

      const config = await loadConfig(tempDir);

      expect(config.version).toBe('1.1');
      expect(config.exclude).toEqual(['temp/**']);
    });

    it('loads JSON config from scheck.config.json', async () => {
      createFile(
        tempDir,
        'scheck.config.json',
        JSON.stringify({
          version: '1.2',
          testPatterns: ['**/*.spec.ts'],
        })
      );

      const config = await loadConfig(tempDir);

      expect(config.version).toBe('1.2');
      expect(config.testPatterns).toEqual(['**/*.spec.ts']);
    });

    it('loads config from .scheckrc', async () => {
      createFile(
        tempDir,
        '.scheckrc',
        `version: '1.0'
servicePatterns:
  - api/**/*.ts`
      );

      const config = await loadConfig(tempDir);

      expect(config.servicePatterns).toEqual(['api/**/*.ts']);
    });

    it('loads config from .scheckrc.yaml', async () => {
      createFile(
        tempDir,
        '.scheckrc.yaml',
        `version: '1.0'
webhookProviders:
  - custom_provider`
      );

      const config = await loadConfig(tempDir);

      expect(config.webhookProviders).toEqual(['custom_provider']);
    });

    it('loads config from .scheckrc.json', async () => {
      createFile(
        tempDir,
        '.scheckrc.json',
        JSON.stringify({
          version: '1.0',
          jobFrameworks: ['custom_framework'],
        })
      );

      const config = await loadConfig(tempDir);

      expect(config.jobFrameworks).toEqual(['custom_framework']);
    });

    it('loads config from securitychecks.config.yaml', async () => {
      createFile(
        tempDir,
        'securitychecks.config.yaml',
        `version: '1.0'
include:
  - source/**/*.ts`
      );

      const config = await loadConfig(tempDir);

      expect(config.include).toEqual(['source/**/*.ts']);
    });

    it('loads config from .scheck directory', async () => {
      mkdirSync(join(tempDir, '.scheck'), { recursive: true });
      createFile(
        tempDir,
        '.scheck/config.yaml',
        `version: '1.3'
include:
  - core/**/*.ts`
      );

      const config = await loadConfig(tempDir);

      expect(config.version).toBe('1.3');
      expect(config.include).toEqual(['core/**/*.ts']);
    });

    it('prefers root config file over directory config', async () => {
      // Create both root config and directory config
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: 'root'`
      );
      mkdirSync(join(tempDir, '.scheck'), { recursive: true });
      createFile(
        tempDir,
        '.scheck/config.yaml',
        `version: 'directory'`
      );

      const config = await loadConfig(tempDir);

      expect(config.version).toBe('root');
    });

    it('uses first matching config file in priority order', async () => {
      // Create multiple config files
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: 'first'`
      );
      createFile(
        tempDir,
        'scheck.config.json',
        JSON.stringify({ version: 'second' })
      );

      const config = await loadConfig(tempDir);

      // scheck.config.yaml should be used (first in CONFIG_FILE_NAMES)
      expect(config.version).toBe('first');
    });
  });

  describe('config merging', () => {
    it('merges authzFunctions additively', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
authzFunctions:
  - customAuth
  - customPermission`
      );

      const config = await loadConfig(tempDir);

      // Should include both default and custom
      expect(config.authzFunctions).toContain('authorize');
      expect(config.authzFunctions).toContain('customAuth');
      expect(config.authzFunctions).toContain('customPermission');
    });

    it('merges cachePatterns additively', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
cachePatterns:
  get:
    - customCache.read
  set:
    - customCache.write`
      );

      const config = await loadConfig(tempDir);

      // Should include both default and custom
      expect(config.cachePatterns!.get).toContain('cache.get');
      expect(config.cachePatterns!.get).toContain('customCache.read');
      expect(config.cachePatterns!.set).toContain('customCache.write');
    });

    it('merges testFileHandling shallowly', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
testFileHandling:
  mode: include`
      );

      const config = await loadConfig(tempDir);

      expect(config.testFileHandling!.mode).toBe('include');
      // Strategy should be preserved from default
      expect(config.testFileHandling!.strategy).toBe('both');
    });

    it('merges partitioning shallowly', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
partitioning:
  enabled: false`
      );

      const config = await loadConfig(tempDir);

      expect(config.partitioning!.enabled).toBe(false);
    });

    it('merges generatedFileHandling shallowly', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
generatedFileHandling:
  mode: include`
      );

      const config = await loadConfig(tempDir);

      expect(config.generatedFileHandling!.mode).toBe('include');
    });

    it('merges calibration config deeply', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
calibration:
  enabled: false
  timeout: 5000`
      );

      const config = await loadConfig(tempDir);

      expect(config.calibration!.enabled).toBe(false);
      expect(config.calibration!.timeout).toBe(5000);
      // Other defaults should be preserved
      expect(config.calibration!.endpoint).toBe(DEFAULT_CONFIG.calibration!.endpoint);
    });

    it('merges calibration.cache deeply', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
calibration:
  cache:
    ttl: 3600`
      );

      const config = await loadConfig(tempDir);

      expect(config.calibration!.cache!.ttl).toBe(3600);
      expect(config.calibration!.cache!.enabled).toBe(true);
    });

    it('replaces arrays entirely for include/exclude', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
include:
  - custom/**/*.ts
exclude:
  - ignore/**`
      );

      const config = await loadConfig(tempDir);

      // Should completely replace, not merge
      expect(config.include).toEqual(['custom/**/*.ts']);
      expect(config.exclude).toEqual(['ignore/**']);
      expect(config.include).not.toContain('src/**/*.ts');
    });

    it('handles partitionOverrides override', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
partitionOverrides:
  - path: apps/web
    include:
      - src/**/*.ts`
      );

      const config = await loadConfig(tempDir);

      expect(config.partitionOverrides).toHaveLength(1);
      expect(config.partitionOverrides![0]!.path).toBe('apps/web');
    });

    it('handles dataflow config merging', async () => {
      createFile(
        tempDir,
        'scheck.config.yaml',
        `version: '1.0'
dataflow:
  enabled: true
  sinks:
    - pattern: db.insert`
      );

      const config = await loadConfig(tempDir);

      expect(config.dataflow!.enabled).toBe(true);
    });
  });

  describe('resolveTargetPath', () => {
    it('returns cwd when input is undefined', () => {
      const result = resolveTargetPath(undefined);

      expect(result).toBe(process.cwd());
    });

    it('returns cwd when input is empty string', () => {
      const result = resolveTargetPath('');

      expect(result).toBe(process.cwd());
    });

    it('resolves relative path', () => {
      const result = resolveTargetPath('some/path');

      expect(result).toContain('some');
      expect(result).toContain('path');
      expect(result.startsWith('/')).toBe(true);
    });

    it('returns absolute path as-is', () => {
      const result = resolveTargetPath('/absolute/path');

      expect(result).toBe('/absolute/path');
    });
  });
});
