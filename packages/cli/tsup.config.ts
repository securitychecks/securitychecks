import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  entry: ['src/index.ts', 'src/lib.ts'],
  format: ['esm'],
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
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
  },
});
