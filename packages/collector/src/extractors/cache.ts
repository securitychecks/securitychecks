/**
 * Cache Extractor
 *
 * Extracts cache operations to detect patterns around authorization
 * and membership caching. Used to verify that cache is properly
 * invalidated when auth state changes.
 */

import { SourceFile, Node, CallExpression } from 'ts-morph';
import type { CacheOperation, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

// Default cache operation patterns
const DEFAULT_CACHE_PATTERNS = {
  get: [
    /cache\.get/i,
    /redis\.get/i,
    /getFromCache/i,
    /getCached/i,
    /fromCache/i,
    /\.get\s*\(/,
    /cacheGet/i,
    /readCache/i,
  ],
  set: [
    /cache\.set/i,
    /redis\.set/i,
    /setCache/i,
    /cacheSet/i,
    /toCache/i,
    /writeCache/i,
    /\.setex\s*\(/i,
  ],
  delete: [
    /cache\.del/i,
    /cache\.delete/i,
    /redis\.del/i,
    /invalidateCache/i,
    /clearCache/i,
    /removeFromCache/i,
    /cacheInvalidate/i,
    /\.del\s*\(/,
  ],
};

// Patterns that indicate auth/membership related caching
const AUTH_CACHE_PATTERNS = [
  /member/i,
  /membership/i,
  /permission/i,
  /role/i,
  /access/i,
  /auth/i,
  /user/i,
  /session/i,
  /token/i,
  /apiKey/i,
  /api-key/i,
  /team/i,
  /org/i,
  /tenant/i,
];

export async function extractCacheOperations(options: ExtractorOptions): Promise<CacheOperation[]> {
  const { targetPath, config } = options;
  const operations: CacheOperation[] = [];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return operations;
  }

  // Build pattern sets from config
  const patterns = buildPatternSets(config);

  // Extract cache operations from each file
  for (const sourceFile of sourceFiles) {
    const fileOps = extractCacheOpsFromFile(sourceFile, targetPath, patterns);
    operations.push(...fileOps);
  }

  return operations;
}

interface PatternSets {
  get: RegExp[];
  set: RegExp[];
  delete: RegExp[];
}

function buildPatternSets(config: ExtractorOptions['config']): PatternSets {
  const configPatterns = config.cachePatterns ?? {};

  return {
    get: [
      ...DEFAULT_CACHE_PATTERNS.get,
      ...(configPatterns.get?.map((p) => new RegExp(p, 'i')) ?? []),
    ],
    set: [
      ...DEFAULT_CACHE_PATTERNS.set,
      ...(configPatterns.set?.map((p) => new RegExp(p, 'i')) ?? []),
    ],
    delete: [
      ...DEFAULT_CACHE_PATTERNS.delete,
      ...(configPatterns.delete?.map((p) => new RegExp(p, 'i')) ?? []),
    ],
  };
}

function extractCacheOpsFromFile(
  sourceFile: SourceFile,
  targetPath: string,
  patterns: PatternSets
): CacheOperation[] {
  const operations: CacheOperation[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const callText = node.getText();
    const operation = detectCacheOperation(callText, patterns);

    if (operation) {
      const key = extractCacheKey(node, callText);
      const callerFunction = getContainingFunctionName(node);

      operations.push({
        file: relativePath,
        line: node.getStartLineNumber(),
        type: operation,
        key,
        callerFunction,
      });
    }
  });

  return operations;
}

function detectCacheOperation(
  callText: string,
  patterns: PatternSets
): CacheOperation['type'] | null {
  // Check delete first (most specific)
  if (patterns.delete.some((p) => p.test(callText))) {
    return 'delete';
  }

  // Then set
  if (patterns.set.some((p) => p.test(callText))) {
    return 'set';
  }

  // Then get
  if (patterns.get.some((p) => p.test(callText))) {
    return 'get';
  }

  return null;
}

function extractCacheKey(node: CallExpression, callText: string): string | undefined {
  // Try to extract the cache key from the first argument
  const args = node.getArguments();
  if (args.length === 0) return undefined;

  const firstArg = args[0];
  if (!firstArg) return undefined;

  // Get the text of the first argument
  const keyText = firstArg.getText();

  // Check if it's auth-related
  const isAuthRelated = AUTH_CACHE_PATTERNS.some((p) => p.test(keyText) || p.test(callText));

  if (isAuthRelated) {
    // Truncate long keys but mark as auth-related
    return keyText.length > 50 ? `[auth] ${keyText.substring(0, 50)}...` : `[auth] ${keyText}`;
  }

  return keyText.length > 50 ? keyText.substring(0, 50) + '...' : keyText;
}

function getContainingFunctionName(node: Node): string | undefined {
  let current = node.getParent();

  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      return current.getName();
    }
    if (Node.isMethodDeclaration(current)) {
      return current.getName();
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
    }

    current = current.getParent();
  }

  return undefined;
}

/**
 * Check if a cache operation is related to auth/membership
 */
export function isAuthRelatedCache(operation: CacheOperation): boolean {
  if (operation.key?.startsWith('[auth]')) {
    return true;
  }

  if (operation.callerFunction) {
    return AUTH_CACHE_PATTERNS.some((p) => p.test(operation.callerFunction!));
  }

  return false;
}
