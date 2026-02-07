import type { AuditConfig } from '../types.js';
import { SourceFile } from 'ts-morph';

const TEST_PATH_PATTERNS = [
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)tests?(\/|$)/,
  /(^|\/)specs?(\/|$)/,
  /(^|\/)e2e(\/|$)/,
  /\.(spec|test|e2e)\.[tj]sx?$/i,
];

const TEST_IMPORT_PATTERNS = [
  /^@jest\//,
  /^@playwright\/test$/,
  /^@testing-library\//,
  /^@cypress\//,
  /^@mswjs\//,
  /^vitest$/,
  /^jest$/,
  /^mocha$/,
  /^chai$/,
  /^sinon$/,
  /^cypress$/,
  /^supertest$/,
  /^nock$/,
  /^msw$/,
  /^node:test$/,
  /^bun:test$/,
  /^tap$/,
  /^ava$/,
  /^uvu$/,
];

const TEST_CALL_PATTERN =
  /\b(describe|it|test|suite|context)\s*(?:\.(only|skip|todo|each))?\s*\(/;
const TEST_HOOK_PATTERN = /\b(beforeEach|afterEach|beforeAll|afterAll)\s*\(/;
const ASSERT_PATTERN = /\b(expect|assert)\s*\(/;
const CYPRESS_PATTERN = /\bcy\./;

export type TestFileMode = 'exclude' | 'include';
export type TestFileStrategy = 'path' | 'heuristic' | 'both';

const DEFAULT_HANDLING: { mode: TestFileMode; strategy: TestFileStrategy } = {
  mode: 'exclude',
  strategy: 'both',
};

export function resolveTestFileHandling(config?: AuditConfig): {
  mode: TestFileMode;
  strategy: TestFileStrategy;
} {
  return {
    mode: config?.testFileHandling?.mode ?? DEFAULT_HANDLING.mode,
    strategy: config?.testFileHandling?.strategy ?? DEFAULT_HANDLING.strategy,
  };
}

export function isLikelyTestPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasTestImports(sourceFile: SourceFile): boolean {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (TEST_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier))) {
      return true;
    }
  }
  return false;
}

function isLikelyTestFileHeuristic(sourceFile: SourceFile): boolean {
  let score = 0;
  if (hasTestImports(sourceFile)) {
    score += 2;
  }

  const text = sourceFile.getFullText();
  if (TEST_CALL_PATTERN.test(text)) {
    score += 1;
  }
  if (TEST_HOOK_PATTERN.test(text)) {
    score += 1;
  }
  if (ASSERT_PATTERN.test(text) || CYPRESS_PATTERN.test(text)) {
    score += 1;
  }

  return score >= 2;
}

export function isLikelyTestFile(sourceFile: SourceFile, relativePath: string): boolean {
  return isLikelyTestPath(relativePath) || isLikelyTestFileHeuristic(sourceFile);
}

export function shouldSkipTestPath(relativePath: string, config?: AuditConfig): boolean {
  const { mode, strategy } = resolveTestFileHandling(config);
  if (mode !== 'exclude') return false;
  if (strategy === 'heuristic') return false;
  return isLikelyTestPath(relativePath);
}

export function shouldSkipTestFile(
  sourceFile: SourceFile,
  relativePath: string,
  config?: AuditConfig
): boolean {
  const { mode, strategy } = resolveTestFileHandling(config);
  if (mode !== 'exclude') return false;
  if (strategy === 'path') return isLikelyTestPath(relativePath);
  if (strategy === 'heuristic') return isLikelyTestFileHeuristic(sourceFile);
  return isLikelyTestFile(sourceFile, relativePath);
}
