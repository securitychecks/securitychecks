import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCallGraph,
  findCallersOf,
  findCalleesOf,
  hasAuthInCallChain,
} from '../src/extractors/callgraph.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
    ...overrides,
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('buildCallGraph', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sc-callgraph-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('empty project', () => {
    it('returns empty graph when no files', async () => {
      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      expect(graph.nodes.size).toBe(0);
      expect(graph.byName.size).toBe(0);
    });
  });

  describe('function declarations', () => {
    it('extracts function declaration', async () => {
      createFile(
        tempDir,
        'src/handler.ts',
        `export function handleRequest() {
  return { ok: true };
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      expect(graph.nodes.size).toBeGreaterThanOrEqual(1);
      const node = Array.from(graph.nodes.values()).find(
        (n) => n.functionName === 'handleRequest'
      );
      expect(node).toBeTruthy();
      expect(node?.file).toBe('src/handler.ts');
    });

    it('extracts function calls within function', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function helper() { return 1; }
export function main() {
  return helper();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const mainNode = Array.from(graph.nodes.values()).find((n) => n.functionName === 'main');
      expect(mainNode?.calls.some((c) => c.targetFunction === 'helper')).toBe(true);
    });
  });

  describe('method declarations', () => {
    it('extracts class method declarations', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export class UserService {
  getUser(id: string) {
    return this.db.findUnique({ where: { id } });
  }
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'getUser');
      expect(node).toBeTruthy();
    });

    it('tracks method calls to other methods', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export class Service {
  validate() { return true; }
  process() {
    if (this.validate()) {
      return 'ok';
    }
  }
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const processNode = Array.from(graph.nodes.values()).find(
        (n) => n.functionName === 'process'
      );
      expect(processNode?.calls.some((c) => c.targetFunction === 'validate')).toBe(true);
    });
  });

  describe('arrow functions', () => {
    it('extracts arrow function assigned to variable', async () => {
      createFile(
        tempDir,
        'src/handler.ts',
        `export const handler = () => {
  return { ok: true };
};`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'handler');
      expect(node).toBeTruthy();
    });

    it('extracts arrow function in object property', async () => {
      createFile(
        tempDir,
        'src/routes.ts',
        `export const routes = {
  getUser: async (id: string) => {
    return db.findUnique({ where: { id } });
  }
};`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'getUser');
      expect(node).toBeTruthy();
    });
  });

  describe('function expressions', () => {
    it('extracts function expression assigned to variable', async () => {
      createFile(
        tempDir,
        'src/handler.ts',
        `export const handler = function handleRequest() {
  return { ok: true };
};`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      // Should find either handler or handleRequest
      const nodes = Array.from(graph.nodes.values());
      const hasHandler = nodes.some((n) => n.functionName === 'handler' || n.functionName === 'handleRequest');
      expect(hasHandler).toBe(true);
    });
  });

  describe('cross-file calls', () => {
    it('resolves named imports (including aliases) across files', async () => {
      createFile(
        tempDir,
        'src/a.ts',
        `export function foo() {
  return 123;
}`
      );

      createFile(
        tempDir,
        'src/b.ts',
        `import { foo as bar } from './a';

export function handler() {
  return bar();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });
      const fooNode = Array.from(graph.nodes.values()).find(
        (n) => n.file === 'src/a.ts' && n.functionName === 'foo'
      );

      expect(fooNode).toBeTruthy();
      expect(fooNode?.calledBy).toEqual(
        expect.arrayContaining([{ callerFunction: 'handler', callerFile: 'src/b.ts' }])
      );
    });

    it('resolves namespace imports', async () => {
      createFile(
        tempDir,
        'src/utils.ts',
        `export function helper() {
  return 42;
}`
      );

      createFile(
        tempDir,
        'src/main.ts',
        `import * as utils from './utils';

export function main() {
  return utils.helper();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const mainNode = Array.from(graph.nodes.values()).find((n) => n.functionName === 'main');
      // Should record the call to helper
      expect(mainNode?.calls.some((c) => c.targetFunction === 'helper')).toBe(true);
    });

    it('resolves default imports', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export default function userService() {
  return {};
}`
      );

      createFile(
        tempDir,
        'src/main.ts',
        `import svc from './service';

export function main() {
  return svc();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const mainNode = Array.from(graph.nodes.values()).find((n) => n.functionName === 'main');
      // Should have call to svc
      expect(mainNode?.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('calledBy edges', () => {
    it('builds reverse edges from calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function helper() { return 1; }
function another() { return 2; }

export function main() {
  helper();
  another();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const helperNode = Array.from(graph.nodes.values()).find(
        (n) => n.functionName === 'helper'
      );
      expect(helperNode?.calledBy?.some((c) => c.callerFunction === 'main')).toBe(true);

      const anotherNode = Array.from(graph.nodes.values()).find(
        (n) => n.functionName === 'another'
      );
      expect(anotherNode?.calledBy?.some((c) => c.callerFunction === 'main')).toBe(true);
    });

    it('avoids duplicate calledBy entries', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function helper() { return 1; }

export function main() {
  helper();
  helper(); // Called twice
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const helperNode = Array.from(graph.nodes.values()).find(
        (n) => n.functionName === 'helper'
      );
      // Should only have one calledBy entry even though called twice
      const mainCallers = helperNode?.calledBy?.filter((c) => c.callerFunction === 'main');
      expect(mainCallers?.length).toBe(1);
    });
  });

  describe('byName index', () => {
    it('indexes nodes by function name', async () => {
      createFile(
        tempDir,
        'src/a.ts',
        `export function handler() { return 1; }`
      );

      createFile(
        tempDir,
        'src/b.ts',
        `export function handler() { return 2; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      // Same function name in different files
      const handlers = graph.byName.get('handler');
      expect(handlers?.length).toBe(2);
      expect(handlers?.some((n) => n.file === 'src/a.ts')).toBe(true);
      expect(handlers?.some((n) => n.file === 'src/b.ts')).toBe(true);
    });
  });

  describe('line numbers', () => {
    it('captures correct line numbers', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `// Line 1
// Line 2
export function handler() { // Line 3
  return 1;
}

export function other() { // Line 7
  return 2;
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const handler = Array.from(graph.nodes.values()).find((n) => n.functionName === 'handler');
      expect(handler?.line).toBe(3);

      const other = Array.from(graph.nodes.values()).find((n) => n.functionName === 'other');
      expect(other?.line).toBe(7);
    });

    it('captures line numbers for calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function helper() { return 1; }

export function main() {
  return helper(); // Line 4
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const mainNode = Array.from(graph.nodes.values()).find((n) => n.functionName === 'main');
      const helperCall = mainNode?.calls.find((c) => c.targetFunction === 'helper');
      expect(helperCall?.line).toBe(4);
    });
  });

  describe('edge cases', () => {
    it('handles async functions', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export async function fetchData() {
  return await fetch('/api');
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'fetchData');
      expect(node).toBeTruthy();
    });

    it('handles generator functions', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function* generateItems() {
  yield 1;
  yield 2;
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find(
        (n) => n.functionName === 'generateItems'
      );
      expect(node).toBeTruthy();
    });

    it('handles nested function calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function a() { return 1; }
function b() { return a(); }
function c() { return b(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      // Check call chain: c -> b -> a
      const cNode = Array.from(graph.nodes.values()).find((n) => n.functionName === 'c');
      expect(cNode?.calls.some((c) => c.targetFunction === 'b')).toBe(true);

      const bNode = Array.from(graph.nodes.values()).find((n) => n.functionName === 'b');
      expect(bNode?.calls.some((c) => c.targetFunction === 'a')).toBe(true);
    });

    it('handles chained method calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function query() {
  return db.select().from(table).where(condition);
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'query');
      expect(node).toBeTruthy();
      // Should capture method calls
      expect(node?.calls.some((c) => c.targetFunction === 'select' || c.targetFunction === 'from')).toBe(true);
    });

    it('skips built-in objects like console, Math, JSON', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  console.log('hello');
  Math.max(1, 2);
  JSON.stringify({});
  return userService.getData();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'handler');
      expect(node).toBeTruthy();
      // Should not include console, Math, JSON calls
      expect(node?.calls.some((c) => c.targetFunction === 'log')).toBe(false);
      expect(node?.calls.some((c) => c.targetFunction === 'max')).toBe(false);
      expect(node?.calls.some((c) => c.targetFunction === 'stringify')).toBe(false);
      // Should include userService.getData
      expect(node?.calls.some((c) => c.targetFunction === 'getData')).toBe(true);
    });

    it('handles IIFE calls returning null from getCallInfo', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  // IIFE - call expression where callee is not identifier or property access
  (function() { return 1; })();
  return helper();
}
function helper() { return 2; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'handler');
      expect(node).toBeTruthy();
      // Should still capture helper call
      expect(node?.calls.some((c) => c.targetFunction === 'helper')).toBe(true);
    });

    it('handles call on call result (chained functions)', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  // getFactory()() - call expression where callee is another call expression
  getFactory()();
  return ok();
}
function getFactory() { return () => 1; }
function ok() { return true; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const node = Array.from(graph.nodes.values()).find((n) => n.functionName === 'handler');
      expect(node).toBeTruthy();
      // Should capture getFactory call and ok call
      expect(node?.calls.some((c) => c.targetFunction === 'getFactory')).toBe(true);
      expect(node?.calls.some((c) => c.targetFunction === 'ok')).toBe(true);
    });
  });

  describe('findCallersOf', () => {
    it('finds direct callers', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function helper() { return 1; }
export function caller1() { return helper(); }
export function caller2() { return helper(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callers = findCallersOf(graph, 'helper');
      expect(callers.length).toBe(2);
      expect(callers.some((c) => c.functionName === 'caller1')).toBe(true);
      expect(callers.some((c) => c.functionName === 'caller2')).toBe(true);
    });

    it('finds indirect callers through call chain', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function target() { return 1; }
function middle() { return target(); }
export function top() { return middle(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callers = findCallersOf(graph, 'target');
      // Should find middle (direct) and top (indirect)
      expect(callers.some((c) => c.functionName === 'middle' && c.depth === 1)).toBe(true);
      expect(callers.some((c) => c.functionName === 'top' && c.depth === 2)).toBe(true);
    });

    it('respects maxDepth parameter', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function a() { return 1; }
function b() { return a(); }
function c() { return b(); }
function d() { return c(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      // With maxDepth 2, should only find b (depth 1) and c (depth 2)
      const callers = findCallersOf(graph, 'a', 2);
      const depths = callers.map((c) => c.depth);
      expect(Math.max(...depths)).toBeLessThanOrEqual(2);
    });

    it('returns empty array for function with no callers', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function standalone() { return 1; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callers = findCallersOf(graph, 'standalone');
      expect(callers).toEqual([]);
    });

    it('returns empty array for unknown function', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() { return 1; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callers = findCallersOf(graph, 'nonExistent');
      expect(callers).toEqual([]);
    });
  });

  describe('findCalleesOf', () => {
    it('finds direct callees', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function helper1() { return 1; }
function helper2() { return 2; }
export function main() {
  helper1();
  helper2();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callees = findCalleesOf(graph, 'main', 'src/service.ts');
      expect(callees.some((c) => c.functionName === 'helper1' && c.depth === 1)).toBe(true);
      expect(callees.some((c) => c.functionName === 'helper2' && c.depth === 1)).toBe(true);
    });

    it('finds indirect callees through call chain', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function leaf() { return 1; }
function middle() { return leaf(); }
export function top() { return middle(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callees = findCalleesOf(graph, 'top', 'src/service.ts');
      expect(callees.some((c) => c.functionName === 'middle' && c.depth === 1)).toBe(true);
      expect(callees.some((c) => c.functionName === 'leaf' && c.depth === 2)).toBe(true);
    });

    it('respects maxDepth parameter', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function a() { return 1; }
function b() { return a(); }
function c() { return b(); }
export function d() { return c(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callees = findCalleesOf(graph, 'd', 'src/service.ts', 2);
      const depths = callees.map((c) => c.depth);
      expect(Math.max(...depths)).toBeLessThanOrEqual(2);
    });

    it('returns empty array for function with no calls', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function noCalls() { return 1; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callees = findCalleesOf(graph, 'noCalls', 'src/service.ts');
      expect(callees).toEqual([]);
    });

    it('handles function not found by file', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() { return 1; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const callees = findCalleesOf(graph, 'handler', 'nonexistent.ts');
      expect(callees).toEqual([]);
    });
  });

  describe('hasAuthInCallChain', () => {
    it('detects auth function in direct callers', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function getData() { return db.query(); }
export function authCheck() { return getData(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const authFunctions = new Set(['authCheck']);
      const result = hasAuthInCallChain(graph, 'getData', authFunctions);

      expect(result.hasAuth).toBe(true);
      expect(result.authLocation?.functionName).toBe('authCheck');
      expect(result.authLocation?.depth).toBe(1);
    });

    it('detects auth function in indirect callers', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function leaf() { return 1; }
function middle() { return leaf(); }
export function authorize() { return middle(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const authFunctions = new Set(['authorize']);
      const result = hasAuthInCallChain(graph, 'leaf', authFunctions);

      expect(result.hasAuth).toBe(true);
      expect(result.authLocation?.functionName).toBe('authorize');
    });

    it('detects auth function called by target', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function authorize() { return true; }
export function handler() {
  authorize();
  return db.query();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const authFunctions = new Set(['authorize']);
      const result = hasAuthInCallChain(graph, 'handler', authFunctions);

      expect(result.hasAuth).toBe(true);
      expect(result.authLocation?.functionName).toBe('handler');
      expect(result.authLocation?.depth).toBe(0);
    });

    it('returns hasAuth false when no auth in chain', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `function helper() { return 1; }
export function handler() { return helper(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const authFunctions = new Set(['authorize', 'checkAuth']);
      const result = hasAuthInCallChain(graph, 'helper', authFunctions);

      expect(result.hasAuth).toBe(false);
      expect(result.authLocation).toBeUndefined();
    });

    it('returns hasAuth false for unknown function', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() { return 1; }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const authFunctions = new Set(['authorize']);
      const result = hasAuthInCallChain(graph, 'nonExistent', authFunctions);

      expect(result.hasAuth).toBe(false);
    });

    it('detects aliased auth function called by target', async () => {
      createFile(
        tempDir,
        'src/auth.ts',
        `export function checkPermissions() { return true; }`
      );

      createFile(
        tempDir,
        'src/service.ts',
        `import { checkPermissions as auth } from './auth';

export function handler() {
  auth();
  return db.query();
}`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      // Check if handler calls the auth function (via alias)
      const authFunctions = new Set(['checkPermissions', 'auth']);
      const result = hasAuthInCallChain(graph, 'handler', authFunctions);

      expect(result.hasAuth).toBe(true);
      expect(result.authLocation?.functionName).toBe('handler');
      expect(result.authLocation?.depth).toBe(0);
    });
  });

  describe('cross-file calledBy resolution', () => {
    it('populates calledBy for cross-file calls with targetFile', async () => {
      createFile(
        tempDir,
        'src/utils.ts',
        `export function helper() { return 1; }`
      );

      createFile(
        tempDir,
        'src/main.ts',
        `import { helper } from './utils';
export function handler() { return helper(); }`
      );

      const graph = await buildCallGraph({ targetPath: tempDir, config: makeConfig() });

      const helperNode = Array.from(graph.nodes.values()).find(
        (n) => n.functionName === 'helper' && n.file === 'src/utils.ts'
      );

      expect(helperNode?.calledBy).toBeDefined();
      expect(helperNode?.calledBy?.some((c) => c.callerFunction === 'handler' && c.callerFile === 'src/main.ts')).toBe(true);
    });
  });
});

