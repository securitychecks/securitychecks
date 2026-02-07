/**
 * Tests for cache extractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractCacheOperations, isAuthRelatedCache } from '../src/extractors/cache.js';
import type { AuditConfig, CacheOperation } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
    authzFunctions: ['authorize'],
    ...overrides,
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('extractCacheOperations', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-cache-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('empty project', () => {
    it('returns empty array when no files', async () => {
      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('get operations', () => {
    it('detects cache.get() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getUser(id: string) {
  const cached = cache.get(id);
  return cached ?? fetchUser(id);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((op) => op.type === 'get')).toBe(true);
    });

    it('detects redis.get() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export async function getData(key: string) {
  return await redis.get(key);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'get')).toBe(true);
    });

    it('detects getFromCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData(key: string) {
  return getFromCache(key);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'get')).toBe(true);
    });

    it('detects getCached() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData(key: string) {
  return getCached(key);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'get')).toBe(true);
    });

    it('detects fromCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return fromCache('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'get')).toBe(true);
    });

    it('detects cacheGet() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cacheGet('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'get')).toBe(true);
    });

    it('detects readCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return readCache('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'get')).toBe(true);
    });
  });

  describe('set operations', () => {
    it('detects cache.set() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function setUser(id: string, data: any) {
  cache.set(id, data);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });

    it('detects redis.set() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export async function setData(key: string, value: any) {
  await redis.set(key, value);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });

    it('detects setCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function setData(key: string, value: any) {
  setCache(key, value);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });

    it('detects cacheSet() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function setData() {
  cacheSet('key', 'value');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });

    it('detects toCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function setData() {
  toCache('key', 'value');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });

    it('detects writeCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function setData() {
  writeCache('key', 'value');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });

    it('detects setex() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export async function setData(key: string, value: any) {
  await redis.setex(key, 3600, value);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });
  });

  describe('delete operations', () => {
    it('detects cache.del() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function clearUser(id: string) {
  cache.del(id);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });

    it('detects cache.delete() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function clearUser(id: string) {
  cache.delete(id);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });

    it('detects redis.del() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export async function clearData(key: string) {
  await redis.del(key);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });

    it('detects invalidateCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function clearData(key: string) {
  invalidateCache(key);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });

    it('detects clearCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function clearData() {
  clearCache('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });

    it('detects removeFromCache() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function clearData() {
  removeFromCache('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });

    it('detects cacheInvalidate() calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function clearData() {
  cacheInvalidate('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });
  });

  describe('auth-related cache keys', () => {
    it('marks member-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('member:123');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks membership-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('membership:org:user');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks permission-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('permission:user:resource');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks role-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('role:admin');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks access-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('access:user:page');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks user-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('user:123');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks session-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('session:abc123');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks token-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('token:refresh:123');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks apiKey-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('apiKey:xyz');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks api-key-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('api-key:xyz');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks team-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('team:123');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks org-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('org:456');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('marks tenant-related keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('tenant:789');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
    });

    it('does not mark non-auth keys as auth', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('product:123');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).not.toContain('[auth]');
    });

    it('truncates long keys', async () => {
      const longKey = 'a'.repeat(100);
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('${longKey}');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key?.length).toBeLessThan(60);
      expect(result[0]?.key).toContain('...');
    });

    it('truncates long auth keys', async () => {
      const longKey = 'user:' + 'a'.repeat(100);
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return cache.get('${longKey}');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.key).toContain('[auth]');
      expect(result[0]?.key).toContain('...');
    });
  });

  describe('caller function detection', () => {
    it('captures caller function name for function declaration', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getUserData(id: string) {
  return cache.get('user:' + id);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.callerFunction).toBe('getUserData');
    });

    it('captures caller function name for method declaration', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `class UserService {
  getData(id: string) {
    return cache.get('user:' + id);
  }
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.callerFunction).toBe('getData');
    });

    it('captures caller function name for arrow function', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `const fetchUser = (id: string) => {
  return cache.get('user:' + id);
};`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.callerFunction).toBe('fetchUser');
    });

    it('captures caller function name for function expression', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `const fetchUser = function(id: string) {
  return cache.get('user:' + id);
};`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.callerFunction).toBe('fetchUser');
    });

    it('returns undefined when no containing function', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `const data = cache.get('key');`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.callerFunction).toBeUndefined();
    });
  });

  describe('custom cache patterns', () => {
    it('uses custom get patterns from config', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData() {
  return myCustomCacheRead('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig({
          cachePatterns: {
            get: ['myCustomCacheRead'],
            set: [],
            delete: [],
          },
        }),
      });

      expect(result.some((op) => op.type === 'get')).toBe(true);
    });

    it('uses custom set patterns from config', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function setData() {
  myCustomCacheWrite('key', 'value');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig({
          cachePatterns: {
            get: [],
            set: ['myCustomCacheWrite'],
            delete: [],
          },
        }),
      });

      expect(result.some((op) => op.type === 'set')).toBe(true);
    });

    it('uses custom delete patterns from config', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function clearData() {
  myCustomCacheRemove('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig({
          cachePatterns: {
            get: [],
            set: [],
            delete: ['myCustomCacheRemove'],
          },
        }),
      });

      expect(result.some((op) => op.type === 'delete')).toBe(true);
    });
  });

  describe('file and line info', () => {
    it('captures file path', async () => {
      createFile(
        tempDir,
        'src/utils/cache-helper.ts',
        `export function getData() {
  return cache.get('key');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.file).toContain('cache-helper.ts');
    });

    it('captures line number', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `// Line 1
// Line 2
export function getData() {
  // Line 4
  return cache.get('key'); // Line 5
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.line).toBe(5);
    });
  });

  describe('multiple operations', () => {
    it('extracts multiple operations from one file', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function getData(key: string) {
  return cache.get(key);
}

export function setData(key: string, value: any) {
  cache.set(key, value);
}

export function deleteData(key: string) {
  cache.del(key);
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(3);
      expect(result.filter((op) => op.type === 'get')).toHaveLength(1);
      expect(result.filter((op) => op.type === 'set')).toHaveLength(1);
      expect(result.filter((op) => op.type === 'delete')).toHaveLength(1);
    });

    it('extracts operations from multiple files', async () => {
      createFile(
        tempDir,
        'src/user.ts',
        `export function getUser() {
  return cache.get('user');
}`
      );
      createFile(
        tempDir,
        'src/product.ts',
        `export function getProduct() {
  return cache.get('product');
}`
      );

      const result = await extractCacheOperations({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(2);
    });
  });
});

describe('isAuthRelatedCache', () => {
  it('returns true for keys starting with [auth]', () => {
    const op: CacheOperation = {
      file: 'test.ts',
      line: 1,
      type: 'get',
      key: '[auth] user:123',
    };

    expect(isAuthRelatedCache(op)).toBe(true);
  });

  it('returns true for auth-related caller functions', () => {
    const op: CacheOperation = {
      file: 'test.ts',
      line: 1,
      type: 'get',
      key: 'data',
      callerFunction: 'getMemberData',
    };

    expect(isAuthRelatedCache(op)).toBe(true);
  });

  it('returns true for permission-related caller functions', () => {
    const op: CacheOperation = {
      file: 'test.ts',
      line: 1,
      type: 'get',
      key: 'data',
      callerFunction: 'getPermissions',
    };

    expect(isAuthRelatedCache(op)).toBe(true);
  });

  it('returns true for role-related caller functions', () => {
    const op: CacheOperation = {
      file: 'test.ts',
      line: 1,
      type: 'get',
      key: 'data',
      callerFunction: 'getUserRoles',
    };

    expect(isAuthRelatedCache(op)).toBe(true);
  });

  it('returns false for non-auth operations', () => {
    const op: CacheOperation = {
      file: 'test.ts',
      line: 1,
      type: 'get',
      key: 'product:123',
      callerFunction: 'getProductData',
    };

    expect(isAuthRelatedCache(op)).toBe(false);
  });

  it('returns false when no key or caller function', () => {
    const op: CacheOperation = {
      file: 'test.ts',
      line: 1,
      type: 'get',
    };

    expect(isAuthRelatedCache(op)).toBe(false);
  });
});
