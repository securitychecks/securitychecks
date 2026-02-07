import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default [
  // Global ignores must come first
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/examples/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.d.ts',
      '**/*.map',
      // Test fixtures (intentionally incomplete example code)
      'packages/collector/test-fixtures/**',
      'packages/collector/tests/fixtures/**',
      // Development scripts (internal tooling)
      'scripts/**',
      // Golden benchmark cloned repos
      'data/golden-benchmark/repos/**',
      // Large auto-generated pattern definition files
      '**/prisma/patterns/**',
      '**/prisma/scripts/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        // React
        React: 'readonly',
        JSX: 'readonly',
        // DOM types used in type annotations
        HTMLDivElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLButtonElement: 'readonly',
        Element: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'security': security,
    },
    rules: {
      // TypeScript handles these
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Allow any for now (can tighten later)
      '@typescript-eslint/no-explicit-any': 'off',

      // Console is fine for CLI tools
      'no-console': 'off',

      // Good practices
      'prefer-const': 'error',
      'no-var': 'error',

      // File size limit - keep files focused
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],

      // Security rules
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-object-injection': 'off', // Too many false positives
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',

      // Disabled for local CLI tools - paths come from user, not untrusted input
      'security/detect-non-literal-fs-filename': 'off',
      // Disabled - patterns come from local config files, not untrusted input
      'security/detect-non-literal-regexp': 'off',
      'security/detect-non-literal-require': 'off',
    },
  },
  // Test files can be longer - comprehensive test suites need more lines
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      'max-lines': ['error', { max: 2000, skipBlankLines: true, skipComments: true }],
    },
  },
];
