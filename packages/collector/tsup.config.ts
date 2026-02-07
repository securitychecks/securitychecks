import { defineConfig } from 'tsup';

const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig([
  // Library build
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    // Disable source maps in production for proprietary distribution
    sourcemap: !isProduction,
    clean: true,
    splitting: false,
    treeshake: true,
    outDir: 'dist',
    target: 'node18',
    // Minify in production
    minify: isProduction,
  },
  // CLI build
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    // Disable source maps in production for proprietary distribution
    sourcemap: !isProduction,
    splitting: false,
    treeshake: true,
    outDir: 'dist',
    target: 'node18',
    // Minify in production
    minify: isProduction,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
