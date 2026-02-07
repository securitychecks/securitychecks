/**
 * Tests for test extractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractTests } from '../src/extractors/tests.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testPatterns: ['**/*.test.ts', '**/*.spec.ts'],
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

describe('extractTests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-tests-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('empty project', () => {
    it('returns empty array when no files', async () => {
      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('basic test extraction', () => {
    it('extracts test with it() call', async () => {
      createFile(
        tempDir,
        'src/example.test.ts',
        `describe('example', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('should work');
      expect(result[0]?.describes).toEqual(['example']);
    });

    it('extracts test with test() call', async () => {
      createFile(
        tempDir,
        'src/example.test.ts',
        `describe('suite', () => {
  test('runs correctly', () => {
    expect(1).toBe(1);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('runs correctly');
    });

    it('handles nested describe blocks', async () => {
      createFile(
        tempDir,
        'src/nested.test.ts',
        `describe('outer', () => {
  describe('inner', () => {
    it('nested test', () => {
      expect(true).toBe(true);
    });
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.describes).toEqual(['outer', 'inner']);
    });

    it('handles context blocks', async () => {
      createFile(
        tempDir,
        'src/context.test.ts',
        `describe('feature', () => {
  context('when condition', () => {
    it('does something', () => {
      expect(true).toBe(true);
    });
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.describes).toEqual(['feature', 'when condition']);
    });

    it('captures line numbers', async () => {
      createFile(
        tempDir,
        'src/lines.test.ts',
        `// Line 1
// Line 2
describe('suite', () => {
  // Line 4
  it('test on line 5', () => {
    expect(true).toBe(true);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.line).toBe(5);
    });

    it('handles template literal test names', async () => {
      createFile(
        tempDir,
        'src/template.test.ts',
        `describe('suite', () => {
  it(\`should handle dynamic name\`, () => {
    expect(true).toBe(true);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('should handle dynamic name');
    });
  });

  describe('test type inference', () => {
    it('infers unit type for regular test files', async () => {
      createFile(
        tempDir,
        'src/utils.test.ts',
        `it('unit test', () => { expect(1).toBe(1); });`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.type).toBe('unit');
    });

    it('infers e2e type for e2e files', async () => {
      createFile(
        tempDir,
        'e2e/login.e2e.test.ts',
        `it('e2e test', () => { expect(1).toBe(1); });`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig({ testPatterns: ['**/*.test.ts', '**/*.e2e.test.ts'] }),
      });

      expect(result[0]?.type).toBe('e2e');
    });

    it('infers e2e type for end-to-end files', async () => {
      createFile(
        tempDir,
        'tests/end-to-end/flow.test.ts',
        `it('flow test', () => { expect(1).toBe(1); });`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.type).toBe('e2e');
    });

    it('infers e2e type for playwright files', async () => {
      createFile(
        tempDir,
        'tests/playwright/browser.test.ts',
        `it('browser test', () => { expect(1).toBe(1); });`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.type).toBe('e2e');
    });

    it('infers integration type for integration files', async () => {
      createFile(
        tempDir,
        'tests/integration/db.test.ts',
        `it('db test', () => { expect(1).toBe(1); });`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.type).toBe('integration');
    });

    it('infers integration type for api files', async () => {
      createFile(
        tempDir,
        'tests/api/users.test.ts',
        `it('api test', () => { expect(1).toBe(1); });`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.type).toBe('integration');
    });
  });

  describe('assertion extraction', () => {
    it('extracts expect assertions', async () => {
      createFile(
        tempDir,
        'src/assert.test.ts',
        `it('has assertions', () => {
  expect(result).toBe(200);
  expect(data).toBeDefined();
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.assertions.length).toBeGreaterThan(0);
    });

    it('extracts assertion line numbers', async () => {
      createFile(
        tempDir,
        'src/status.test.ts',
        `it('checks status', () => {
  expect(response).toBeDefined();
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.assertions.length).toBe(1);
      expect(result[0]?.assertions[0]?.line).toBeDefined();
    });

    it('marks assertions as not permissive by default', async () => {
      createFile(
        tempDir,
        'src/status.test.ts',
        `it('checks value', () => {
  expect(result).toBe(42);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.assertions[0]?.isPermissive).toBe(false);
    });
  });

  describe('anti-pattern: sleep', () => {
    it('detects setTimeout usage', async () => {
      createFile(
        tempDir,
        'src/timing.test.ts',
        `it('waits with setTimeout', async () => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(result).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const sleepPattern = result[0]?.antiPatterns.find((p) => p.type === 'sleep');
      expect(sleepPattern).toBeDefined();
      expect(sleepPattern?.description).toContain('timing-based');
    });

    it('detects sleep function usage', async () => {
      createFile(
        tempDir,
        'src/timing.test.ts',
        `it('uses sleep', async () => {
  await sleep(1000);
  expect(result).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'sleep')).toBe(true);
    });

    it('detects delay function usage', async () => {
      createFile(
        tempDir,
        'src/timing.test.ts',
        `it('uses delay', async () => {
  await delay(500);
  expect(result).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'sleep')).toBe(true);
    });

    it('detects wait function usage', async () => {
      createFile(
        tempDir,
        'src/timing.test.ts',
        `it('uses wait', async () => {
  await wait(500);
  expect(result).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'sleep')).toBe(true);
    });
  });

  describe('anti-pattern: silent_skip', () => {
    it('detects nested .skip call without TODO comment', async () => {
      createFile(
        tempDir,
        'src/skipped.test.ts',
        `it('test with skip', () => {
  someTest.skip();
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'silent_skip')).toBe(true);
    });

    it('detects nested .todo call without TODO comment', async () => {
      createFile(
        tempDir,
        'src/todo.test.ts',
        `it('test with todo', () => {
  feature.todo();
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'silent_skip')).toBe(true);
    });

    it('does not flag skip with TODO comment nearby', async () => {
      createFile(
        tempDir,
        'src/skipped.test.ts',
        `it('test with skip', () => {
  // TODO: enable when feature ready
  someTest.skip();
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'silent_skip')).toBe(false);
    });

    it('does not flag skip with FIXME comment', async () => {
      createFile(
        tempDir,
        'src/skipped.test.ts',
        `it('test with skip', () => {
  // FIXME: flaky on CI
  someTest.skip();
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'silent_skip')).toBe(false);
    });

    it('does not flag skip with JIRA ticket', async () => {
      createFile(
        tempDir,
        'src/skipped.test.ts',
        `it('test with skip', () => {
  // JIRA-1234
  someTest.skip();
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'silent_skip')).toBe(false);
    });

    it('does not flag skip with LINEAR ticket', async () => {
      createFile(
        tempDir,
        'src/skipped.test.ts',
        `it('test with skip', () => {
  // LINEAR ABC-123
  someTest.skip();
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'silent_skip')).toBe(false);
    });

    it('does not flag skip with ticket pattern', async () => {
      createFile(
        tempDir,
        'src/skipped.test.ts',
        `it('test with skip', () => {
  // ENG-456
  someTest.skip();
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'silent_skip')).toBe(false);
    });
  });

  describe('anti-pattern: error_swallowing', () => {
    it('detects empty catch block', async () => {
      createFile(
        tempDir,
        'src/catch.test.ts',
        `it('swallows error', async () => {
  try {
    await riskyOperation();
  } catch (e) {}
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'error_swallowing')).toBe(true);
    });

    it('detects catch with only console.log', async () => {
      createFile(
        tempDir,
        'src/catch.test.ts',
        `it('logs error only', async () => {
  try {
    await riskyOperation();
  } catch (e) { console.log(e); }
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'error_swallowing')).toBe(true);
    });

    it('detects catch with only console.error', async () => {
      createFile(
        tempDir,
        'src/catch.test.ts',
        `it('logs error only', async () => {
  try {
    await riskyOperation();
  } catch (e) { console.error(e); }
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'error_swallowing')).toBe(true);
    });

    it('detects catch without assertion', async () => {
      createFile(
        tempDir,
        'src/catch.test.ts',
        `it('catches without assertion', async () => {
  try {
    await riskyOperation();
  } catch (e) {
    const message = e.message;
  }
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'error_swallowing')).toBe(true);
    });

    it('does not flag catch with expect', async () => {
      createFile(
        tempDir,
        'src/catch.test.ts',
        `it('asserts on error', async () => {
  try {
    await riskyOperation();
  } catch (e) {
    expect(e.message).toBe('Expected error');
  }
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'error_swallowing')).toBe(false);
    });

    it('does not flag catch with assert', async () => {
      createFile(
        tempDir,
        'src/catch.test.ts',
        `it('asserts on error', async () => {
  try {
    await riskyOperation();
  } catch (e) {
    assert.strictEqual(e.message, 'Expected error');
  }
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'error_swallowing')).toBe(false);
    });

    it('does not flag catch with throw', async () => {
      createFile(
        tempDir,
        'src/catch.test.ts',
        `it('rethrows error', async () => {
  try {
    await riskyOperation();
  } catch (e) {
    throw new Error('Wrapped: ' + e.message);
  }
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'error_swallowing')).toBe(false);
    });
  });

  describe('anti-pattern: permissive_assertion', () => {
    it('detects toBe with OR', async () => {
      createFile(
        tempDir,
        'src/permissive.test.ts',
        `it('accepts multiple values', () => {
  expect(response.status.toBe(200 || 201));
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'permissive_assertion')).toBe(true);
    });

    it('detects toBeOneOf', async () => {
      createFile(
        tempDir,
        'src/permissive.test.ts',
        `it('accepts multiple values', () => {
  expect(status).toBeOneOf([200, 201, 204]);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'permissive_assertion')).toBe(true);
    });

    it('detects toBeIn', async () => {
      createFile(
        tempDir,
        'src/permissive.test.ts',
        `it('accepts multiple values', () => {
  expect(value).toBeIn(['a', 'b', 'c']);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'permissive_assertion')).toBe(true);
    });

    it('detects double expect OR', async () => {
      createFile(
        tempDir,
        'src/permissive.test.ts',
        `it('accepts either', () => {
  expect(a).toBe(1) || expect(b).toBe(2);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'permissive_assertion')).toBe(true);
    });
  });

  describe('anti-pattern: always_passes', () => {
    it('detects expect(true).toBe(true)', async () => {
      createFile(
        tempDir,
        'src/tautology.test.ts',
        `it('always passes', () => {
  expect(true).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'always_passes')).toBe(true);
    });

    it('detects expect(false).toBe(false)', async () => {
      createFile(
        tempDir,
        'src/tautology.test.ts',
        `it('always passes', () => {
  expect(false).toBe(false);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'always_passes')).toBe(true);
    });

    it('detects expect(1).toBe(1)', async () => {
      createFile(
        tempDir,
        'src/tautology.test.ts',
        `it('always passes', () => {
  expect(1).toBe(1);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'always_passes')).toBe(true);
    });

    it('detects expect(true).toEqual(true)', async () => {
      createFile(
        tempDir,
        'src/tautology.test.ts',
        `it('always passes', () => {
  expect(true).toEqual(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'always_passes')).toBe(true);
    });

    it('detects expect(literal).toBeDefined()', async () => {
      createFile(
        tempDir,
        'src/tautology.test.ts',
        `it('always passes', () => {
  expect('hello').toBeDefined();
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'always_passes')).toBe(true);
    });

    it('detects expect(truthy literal).toBeTruthy()', async () => {
      createFile(
        tempDir,
        'src/tautology.test.ts',
        `it('always passes', () => {
  expect(1).toBeTruthy();
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'always_passes')).toBe(true);
    });

    it('does not flag expect(variable).toBe(value)', async () => {
      createFile(
        tempDir,
        'src/valid.test.ts',
        `it('tests variable', () => {
  const result = calculate();
  expect(result).toBe(42);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'always_passes')).toBe(false);
    });
  });

  describe('anti-pattern: no_assertions', () => {
    it('detects test without assertions', async () => {
      createFile(
        tempDir,
        'src/empty.test.ts',
        `it('does nothing', () => {
  const x = 1 + 1;
  console.log(x);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(true);
    });

    it('does not flag test with expect', async () => {
      createFile(
        tempDir,
        'src/valid.test.ts',
        `it('has assertion', () => {
  expect(1).toBe(1);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('does not flag test with assert function', async () => {
      createFile(
        tempDir,
        'src/valid.test.ts',
        `it('has assertion', () => {
  assert(value === 1);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('does not flag setup tests', async () => {
      createFile(
        tempDir,
        'src/setup.test.ts',
        `it('setup database', async () => {
  await db.connect();
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('does not flag helper tests', async () => {
      createFile(
        tempDir,
        'src/helper.test.ts',
        `it('helper function', () => {
  setupTestData();
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('counts custom expectX helpers as assertions', async () => {
      createFile(
        tempDir,
        'src/custom.test.ts',
        `it('uses custom helper', () => {
  expectRedirectTo(response, '/login');
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('counts verifyX helpers as assertions', async () => {
      createFile(
        tempDir,
        'src/custom.test.ts',
        `it('uses verify helper', () => {
  verifyResponse(response);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('counts checkX helpers as assertions', async () => {
      createFile(
        tempDir,
        'src/custom.test.ts',
        `it('uses check helper', () => {
  checkStatus(response, 200);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('counts supertest .expect() as assertions', async () => {
      createFile(
        tempDir,
        'src/api.test.ts',
        `it('tests api', async () => {
  await request(app)
    .get('/users')
    .expect(200);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('counts chai-style .should assertions', async () => {
      createFile(
        tempDir,
        'src/chai.test.ts',
        `it('uses chai', () => {
  result.should.equal(expected);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('counts helper functions with assertions', async () => {
      createFile(
        tempDir,
        'src/helper.test.ts',
        `function assertResponse(res) {
  expect(res.status).toBe(200);
}

it('uses helper', () => {
  assertResponse(response);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('counts arrow function helpers with assertions', async () => {
      createFile(
        tempDir,
        'src/helper.test.ts',
        `const validateUser = (user) => {
  expect(user.id).toBeDefined();
};

it('validates', () => {
  validateUser(user);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });
  });

  describe('anti-pattern: mocked_sut', () => {
    it('detects mockReturnValue with expect on mock call', async () => {
      createFile(
        tempDir,
        'src/mocked.test.ts',
        `it('tests mock', () => {
  mockFn.mockReturnValue(42);
  expect(mockFn()).toBe(42);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'mocked_sut')).toBe(true);
    });

    it('detects mockResolvedValue with expect on mock call', async () => {
      createFile(
        tempDir,
        'src/mocked.test.ts',
        `it('tests mock', async () => {
  mockFetch.mockResolvedValue({ data: 'test' });
  const result = mockFetch();
  expect(mockFetch()).toEqual({ data: 'test' });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'mocked_sut')).toBe(true);
    });

    it('detects mocking same module as test file', async () => {
      createFile(
        tempDir,
        'src/auth.test.ts',
        `jest.mock('./auth');

it('tests auth', () => {
  expect(login()).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'mocked_sut')).toBe(true);
    });

    it('does not flag mocking dependencies', async () => {
      createFile(
        tempDir,
        'src/service.test.ts',
        `jest.mock('./database');

it('tests service with mocked db', () => {
  mockedDb.mockReturnValue([]);
  const result = getUsers();
  expect(result).toEqual([]);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'mocked_sut')).toBe(false);
    });

    it('does not flag spyOn with real function call', async () => {
      createFile(
        tempDir,
        'src/spy.test.ts',
        `it('tests with spy', () => {
  jest.spyOn(auth, 'validate');
  const result = validateUser(user);
  expect(result).toBe(true);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'mocked_sut')).toBe(false);
    });
  });

  describe('multiple files', () => {
    it('extracts tests from multiple files', async () => {
      createFile(
        tempDir,
        'src/a.test.ts',
        `it('test a', () => { expect(1).toBe(1); });`
      );
      createFile(
        tempDir,
        'src/b.test.ts',
        `it('test b', () => { expect(2).toBe(2); });`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(2);
      expect(result.some((t) => t.name === 'test a')).toBe(true);
      expect(result.some((t) => t.name === 'test b')).toBe(true);
    });
  });

  describe('it.only and test.only', () => {
    it('handles it.only syntax', async () => {
      createFile(
        tempDir,
        'src/only.test.ts',
        `describe('suite', () => {
  it.only('focused test', () => {
    expect(true).toBe(true);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('focused test');
    });

    it('handles test.only syntax', async () => {
      createFile(
        tempDir,
        'src/only.test.ts',
        `describe('suite', () => {
  test.only('focused test', () => {
    expect(true).toBe(true);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('focused test');
    });

    it('handles describe.only syntax', async () => {
      createFile(
        tempDir,
        'src/only.test.ts',
        `describe.only('focused suite', () => {
  it('inner test', () => {
    expect(true).toBe(true);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.describes).toEqual(['focused suite']);
    });
  });

  describe('spec files', () => {
    it('extracts from .spec.ts files', async () => {
      createFile(
        tempDir,
        'src/example.spec.ts',
        `describe('spec', () => {
  it('works', () => {
    expect(true).toBe(true);
  });
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
    });
  });

  describe('helper function detection', () => {
    it('detects assertions in function expression helpers', async () => {
      createFile(
        tempDir,
        'src/helper.test.ts',
        `const checkResult = function(result) {
  expect(result.status).toBe(200);
};

it('uses function expression helper', () => {
  checkResult(response);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });
  });

  describe('assertion types', () => {
    it('handles assertX function patterns', async () => {
      createFile(
        tempDir,
        'src/assert.test.ts',
        `it('uses assertX', () => {
  assertStrictEqual(actual, expected);
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });

    it('handles custom assertion chains', async () => {
      createFile(
        tempDir,
        'src/chain.test.ts',
        `it('uses chain', () => {
  result.should.have.property('id');
});`
      );

      const result = await extractTests({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.antiPatterns.some((p) => p.type === 'no_assertions')).toBe(false);
    });
  });
});
