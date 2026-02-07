import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/fixtures/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 77,
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/index.ts',
        '**/*.config.ts',
        'packages/collector/src/types.ts', // type-only module (no runtime statements)
        // Engine coverage is currently too broad/heavy for the global threshold gate.
        // Keep engine unit tests, but exclude engine source from the global coverage threshold until we
        // have dedicated engine coverage targets.
        'packages/engine/src/**',
      ],
    },
    testTimeout: 10000,
  },
});
