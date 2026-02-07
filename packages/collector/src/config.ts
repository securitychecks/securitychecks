/**
 * Default configuration and config loading for SecurityChecks
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AuditConfig } from './types.js';

export const DEFAULT_CONFIG: AuditConfig = {
  version: '1.0',

  // Default paths to scan
  // Support both simple projects and monorepos (packages/, apps/)
  include: [
    // TypeScript (primary)
    'src/**/*.ts',
    'src/**/*.tsx',
    'lib/**/*.ts',
    'app/**/*.ts',
    'app/**/*.tsx',
    // Monorepo support
    'packages/**/*.ts',
    'packages/**/*.tsx',
    'apps/**/*.ts',
    'apps/**/*.tsx',
    // API routes
    'pages/api/**/*.ts',
    'pages/api/**/*.tsx',
    // JavaScript (for Koa, Hapi, Fastify, Express backends)
    'src/**/*.js',
    'lib/**/*.js',
    'routes/**/*.js',
    'plugins/**/*.js',
    'app/**/*.js',
  ],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/*.d.ts',
    '**/*.test.ts',
    '**/*.test.js',
    '**/*.spec.ts',
    '**/*.spec.js',
    '**/__tests__/**',
    // Data and benchmark directories (not actual code)
    '**/data/**',
    '**/golden-benchmark/**',
    '**/benchmark/**',
    '**/fixtures/**',
    '**/samples/**',
    '**/examples/**',
    // Generated/vendored code
    '**/generated/**',
    '**/vendor/**',
    '**/.cache/**',
  ],

  // Test file patterns
  testPatterns: [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.test.js',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/*.spec.js',
    '**/tests/**/*.ts',
    '**/tests/**/*.js',
    '**/__tests__/**/*.ts',
    '**/__tests__/**/*.js',
    '**/e2e/**/*.ts',
    '**/e2e/**/*.js',
  ],

  // Service file patterns (where authz should be enforced)
  servicePatterns: [
    '**/services/**/*.ts',
    '**/services/**/*.js',
    '**/service/**/*.ts',
    '**/service/**/*.js',
    '**/lib/**/*.ts',
    '**/lib/**/*.js',
    '**/server/**/*.ts',
    '**/server/**/*.js',
    '**/api/**/*.ts',
    '**/api/**/*.js',
  ],

  // Common authorization function names
  authzFunctions: [
    'authorize',
    'requireAuth',
    'checkAuth',
    'checkPermission',
    'checkAccess',
    'requirePermission',
    'ensureAuth',
    'ensureAuthenticated',
    'assertAuth',
    'assertPermission',
    'verifyAuth',
    'verifyAccess',
    'canAccess',
    'hasPermission',
    'isAuthorized',
  ],

  // Cache operation patterns
  cachePatterns: {
    get: ['cache.get', 'redis.get', 'getFromCache', 'getCached', 'fromCache'],
    set: ['cache.set', 'redis.set', 'setCache', 'cacheSet', 'toCache'],
    delete: [
      'cache.del',
      'cache.delete',
      'redis.del',
      'invalidateCache',
      'clearCache',
      'removeFromCache',
    ],
  },

  // Webhook providers to detect
  webhookProviders: ['stripe', 'github', 'slack', 'twilio', 'sendgrid', 'lemon_squeezy'],

  // Job frameworks to detect
  jobFrameworks: ['bullmq', 'inngest', 'trigger.dev', 'quirrel', 'agenda'],

  // Test file handling for non-test extractors
  testFileHandling: {
    mode: 'exclude',
    strategy: 'both',
  },

  // Partitioning (monorepo-aware scanning)
  partitioning: {
    enabled: true,
  },

  // Generated file handling for file inventory
  generatedFileHandling: {
    mode: 'exclude',
    strategy: 'both',
  },

  // Calibration API settings (optional, advisory)
  // "The SaaS advises. The local tool decides."
  calibration: {
    enabled: true, // Enable by default to build data moat
    endpoint: 'https://api.securitychecks.ai/v1/calibrate',
    timeout: 2000, // 2 second timeout (fail-fast)
    minConfidence: 0.85, // Only apply high-confidence suggestions
    cache: {
      enabled: true,
      ttl: 86400, // 24 hours
    },
  },
};

export const CONFIG_FILE_NAMES = [
  // scheck (primary)
  'scheck.config.yaml',
  'scheck.config.yml',
  'scheck.config.json',
  '.scheckrc',
  '.scheckrc.yaml',
  '.scheckrc.yml',
  '.scheckrc.json',
  // securitychecks (long-form)
  'securitychecks.config.yaml',
  'securitychecks.config.yml',
  'securitychecks.config.json',
  // Legacy (auditchecks) - deprecated
  'auditchecks.config.yaml',
];

export async function loadConfig(targetPath: string): Promise<AuditConfig> {
  // Look for config file in target path
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = join(targetPath, fileName);
    if (existsSync(configPath)) {
      const content = await readFile(configPath, 'utf-8');
      const parsed = fileName.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
      return mergeConfig(DEFAULT_CONFIG, parsed);
    }
  }

  // Check for config in .scheck directory (primary)
  const scheckDir = join(targetPath, '.scheck');
  if (existsSync(scheckDir)) {
    const configPath = join(scheckDir, 'config.yaml');
    if (existsSync(configPath)) {
      const content = await readFile(configPath, 'utf-8');
      const parsed = parseYaml(content);
      return mergeConfig(DEFAULT_CONFIG, parsed);
    }
  }

  // Return default config if no config file found
  return DEFAULT_CONFIG;
}

function mergeConfig(base: AuditConfig, override: Partial<AuditConfig>): AuditConfig {
  return {
    ...base,
    ...override,
    // Deep merge arrays (replace, don't append for most)
    include: override.include ?? base.include,
    exclude: override.exclude ?? base.exclude,
    testPatterns: override.testPatterns ?? base.testPatterns,
    servicePatterns: override.servicePatterns ?? base.servicePatterns,
    authzFunctions: override.authzFunctions
      ? [...new Set([...base.authzFunctions!, ...override.authzFunctions])]
      : base.authzFunctions,
    cachePatterns: override.cachePatterns
      ? {
          get: [...new Set([...(base.cachePatterns?.get ?? []), ...(override.cachePatterns.get ?? [])])],
          set: [...new Set([...(base.cachePatterns?.set ?? []), ...(override.cachePatterns.set ?? [])])],
          delete: [
            ...new Set([...(base.cachePatterns?.delete ?? []), ...(override.cachePatterns.delete ?? [])]),
          ],
        }
      : base.cachePatterns,
    testFileHandling: override.testFileHandling
      ? { ...base.testFileHandling, ...override.testFileHandling }
      : base.testFileHandling,
    partitioning: override.partitioning
      ? { ...base.partitioning, ...override.partitioning }
      : base.partitioning,
    partitionOverrides: override.partitionOverrides ?? base.partitionOverrides,
    generatedFileHandling: override.generatedFileHandling
      ? { ...base.generatedFileHandling, ...override.generatedFileHandling }
      : base.generatedFileHandling,
    dataflow: override.dataflow
      ? { ...(base.dataflow ?? {}), ...override.dataflow }
      : base.dataflow,
    // Deep merge calibration config
    calibration: override.calibration
      ? {
          ...base.calibration!,
          ...override.calibration,
          cache: override.calibration.cache
            ? { ...base.calibration?.cache, ...override.calibration.cache }
            : base.calibration?.cache,
        }
      : base.calibration,
  };
}

export function resolveTargetPath(input?: string): string {
  if (!input) {
    return process.cwd();
  }
  return resolve(input);
}
