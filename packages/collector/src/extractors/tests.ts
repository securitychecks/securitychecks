/**
 * Test Extractor
 *
 * Extracts test file information including:
 * - What tests exist
 * - What they test (describe blocks, test names)
 * - Anti-patterns:
 *   - sleep/setTimeout (timing-dependent tests)
 *   - silent_skip (skipped without TODO/ticket)
 *   - permissive_assertion (200 || 201, toBeOneOf)
 *   - mocked_sut (mocking the function being tested)
 *   - no_assertions (tests with no expect/assert)
 *   - always_passes (tests that can never fail)
 *   - error_swallowing (try/catch without assertions)
 *   - no_cleanup (async resources not cleaned up)
 */

import { SourceFile, Node, CallExpression } from 'ts-morph';
import type { TestEntry, AssertionInfo, TestAntiPattern, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

export async function extractTests(options: ExtractorOptions): Promise<TestEntry[]> {
  const { targetPath, config } = options;
  const tests: TestEntry[] = [];

  const testIgnore = config.exclude.filter((e) => !e.includes('test') && !e.includes('spec'));
  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.testPatterns,
    ignore: testIgnore,
    skipTests: false,
  });

  if (sourceFiles.length === 0) {
    return tests;
  }

  // Extract test entries from each file
  for (const sourceFile of sourceFiles) {
    const fileTests = extractTestsFromFile(sourceFile, targetPath);
    tests.push(...fileTests);
  }

  return tests;
}

function extractTestsFromFile(sourceFile: SourceFile, targetPath: string): TestEntry[] {
  const tests: TestEntry[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');

  // Build helper function map for 1-level deep tracing
  const helperFunctionsWithAssertions = buildHelperFunctionMap(sourceFile);

  // Find all test/it calls
  const describeStack: string[] = [];

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const name = getCallName(node);
    if (!name) return;

    // Track describe blocks for context
    if (name === 'describe' || name === 'context') {
      const describeName = getFirstStringArgument(node);
      if (describeName) {
        describeStack.push(describeName);
      }
    }

    // Extract test entries
    if (name === 'it' || name === 'test') {
      const testName = getFirstStringArgument(node);
      if (testName) {
        const assertions = extractAssertions(node);
        const antiPatterns = extractAntiPatterns(node, sourceFile, helperFunctionsWithAssertions);

        tests.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          name: testName,
          type: inferTestType(relativePath),
          describes: [...describeStack],
          assertions,
          antiPatterns,
        });
      }
    }
  });

  return tests;
}

/**
 * Build a map of helper functions in this file that contain assertions.
 * This enables 1-level deep tracing - if a test calls a helper function
 * that contains expect/assert, we count that as having assertions.
 */
function buildHelperFunctionMap(sourceFile: SourceFile): Set<string> {
  const helpersWithAssertions = new Set<string>();

  sourceFile.forEachDescendant((node) => {
    // Check function declarations
    if (Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (name && containsAssertion(node)) {
        helpersWithAssertions.add(name);
      }
    }

    // Check arrow functions assigned to const/let
    if (Node.isVariableDeclaration(node)) {
      const name = node.getName();
      const initializer = node.getInitializer();
      if (name && initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        if (containsAssertion(initializer)) {
          helpersWithAssertions.add(name);
        }
      }
    }
  });

  return helpersWithAssertions;
}

/**
 * Check if a node contains assertion calls (expect, assert, etc.)
 */
function containsAssertion(node: Node): boolean {
  let hasAssertion = false;

  node.forEachDescendant((child) => {
    if (hasAssertion) return; // Early exit optimization

    if (Node.isCallExpression(child)) {
      const name = getCallName(child);
      // Standard assertion patterns
      if (name === 'expect' || name === 'assert' || name?.startsWith('assert')) {
        hasAssertion = true;
        return;
      }
      // Custom assertion helpers: expectRedirectTo(), verifyX(), checkX()
      if (name?.startsWith('expect') || name?.startsWith('verify') || name?.startsWith('check')) {
        hasAssertion = true;
        return;
      }
      // Supertest-style .expect()
      const expr = child.getExpression();
      if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'expect') {
        hasAssertion = true;
        return;
      }
    }
  });

  return hasAssertion;
}

function getCallName(node: CallExpression): string | undefined {
  const expression = node.getExpression();

  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }

  // Handle test.skip, it.only, etc.
  if (Node.isPropertyAccessExpression(expression)) {
    const object = expression.getExpression();
    if (Node.isIdentifier(object)) {
      const objName = object.getText();
      if (['it', 'test', 'describe'].includes(objName)) {
        return objName;
      }
    }
  }

  return undefined;
}

function getFirstStringArgument(node: CallExpression): string | undefined {
  const args = node.getArguments();
  if (args.length === 0) return undefined;

  const firstArg = args[0];
  if (!firstArg) return undefined;

  if (Node.isStringLiteral(firstArg)) {
    return firstArg.getLiteralValue();
  }

  if (Node.isTemplateExpression(firstArg) || Node.isNoSubstitutionTemplateLiteral(firstArg)) {
    return firstArg.getText().replace(/^`|`$/g, '');
  }

  return undefined;
}

function inferTestType(filePath: string): 'unit' | 'integration' | 'e2e' {
  const lower = filePath.toLowerCase();
  if (lower.includes('e2e') || lower.includes('end-to-end') || lower.includes('playwright')) {
    return 'e2e';
  }
  if (lower.includes('integration') || lower.includes('api')) {
    return 'integration';
  }
  return 'unit';
}

function extractAssertions(testNode: CallExpression): AssertionInfo[] {
  const assertions: AssertionInfo[] = [];

  testNode.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const name = getCallName(node);
    if (!name) return;

    // Detect expect calls
    if (name === 'expect') {
      const assertionInfo = analyzeExpectChain(node);
      if (assertionInfo) {
        assertions.push(assertionInfo);
      }
    }
  });

  return assertions;
}

function analyzeExpectChain(expectNode: CallExpression): AssertionInfo | undefined {
  const line = expectNode.getStartLineNumber();

  // Walk up to find the full assertion chain
  const _current = expectNode.getParent(); // Reserved for chain analysis
  let type: AssertionInfo['type'] = 'unknown';

  // Check for status code assertions
  const fullText = expectNode.getParent()?.getText() ?? '';
  if (fullText.includes('200') || fullText.includes('201')) {
    type = 'status';
  }

  // NOTE: "permissive" assertion detection was removed because patterns like
  // expect([200, 403]).toContain(status) are INTENTIONAL behavior, not bugs.
  // The test is explicitly saying "result should be one of these valid values".
  // This is different from tests that don't make proper assertions.
  // The isPermissive flag is kept for backwards compatibility but always false.

  return { line, type, isPermissive: false };
}

function extractAntiPatterns(
  testNode: CallExpression,
  sourceFile: SourceFile,
  helperFunctionsWithAssertions: Set<string> = new Set()
): TestAntiPattern[] {
  const antiPatterns: TestAntiPattern[] = [];
  const fullText = testNode.getText();
  const testName = getFirstStringArgument(testNode) ?? '';

  // Track assertion count for no_assertions detection
  let assertionCount = 0;

  testNode.forEachDescendant((node) => {
    // Count assertions
    if (Node.isCallExpression(node)) {
      const name = getCallName(node);
      // Standard assertion libraries (jest, vitest, node:assert)
      if (name === 'expect' || name === 'assert' || name?.startsWith('assert')) {
        assertionCount++;
      }
      // Custom assertion helpers: expectRedirectTo(), expectPrismaCalledWith(), etc.
      // These are functions that wrap expect() - very common in well-structured tests
      if (name?.startsWith('expect') && name !== 'expect') {
        assertionCount++;
      }
      // Other custom assertion patterns: verifyX(), assertX(), checkX()
      if (name?.startsWith('verify') || name?.startsWith('check')) {
        assertionCount++;
      }
      // Helper function tracing: if this test calls a helper function
      // that contains assertions, count it as having assertions
      if (name && helperFunctionsWithAssertions.has(name)) {
        assertionCount++;
      }
      // Supertest-style assertions: request(app).get('/').expect(200)
      // These use .expect() as a method on the request object
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const propName = expr.getName();
        // Supertest: .expect(statusCode) or .expect('header', value)
        if (propName === 'expect') {
          assertionCount++;
        }
        // Chai-style: .should.equal(), .should.have.property(), etc.
        if (propName === 'should' || propName === 'equal' || propName === 'eql' ||
            propName === 'include' || propName === 'contain' || propName === 'have' ||
            propName === 'be' || propName === 'property') {
          assertionCount++;
        }
      }
    }

    // Check for sleep/setTimeout
    if (Node.isCallExpression(node)) {
      const name = getCallName(node);
      if (name === 'setTimeout' || name === 'sleep' || name === 'delay' || name === 'wait') {
        antiPatterns.push({
          type: 'sleep',
          line: node.getStartLineNumber(),
          description: 'Test uses timing-based waiting instead of explicit waits',
        });
      }
    }

    // Check for test.skip without TODO
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        const propName = expr.getName();
        if (propName === 'skip' || propName === 'todo') {
          // Check if there's a TODO comment nearby
          const leadingComments = node.getLeadingCommentRanges();
          const hasTicket = leadingComments.some(
            (c) =>
              c.getText().includes('TODO') ||
              c.getText().includes('FIXME') ||
              c.getText().includes('JIRA') ||
              c.getText().includes('LINEAR') ||
              /[A-Z]+-[0-9]+/.test(c.getText())
          );

          if (!hasTicket) {
            antiPatterns.push({
              type: 'silent_skip',
              line: node.getStartLineNumber(),
              description: 'Test is skipped without a TODO or ticket reference',
            });
          }
        }
      }
    }

    // Check for error swallowing (try/catch without assertions)
    if (Node.isTryStatement(node)) {
      const catchClause = node.getCatchClause();
      if (catchClause) {
        const catchBlock = catchClause.getBlock();
        const catchText = catchBlock.getText();

        // Empty catch block
        if (catchText.trim() === '{}') {
          antiPatterns.push({
            type: 'error_swallowing',
            line: node.getStartLineNumber(),
            description: 'Test has empty catch block - errors are silently ignored',
          });
        }
        // Catch with only console.log (simplified check to avoid ReDoS)
        else if (/^\s*\{\s*console\.(log|warn|error|info)\s*\(/.test(catchText) &&
                 !catchText.includes('expect') && !catchText.includes('assert') && !catchText.includes('throw')) {
          antiPatterns.push({
            type: 'error_swallowing',
            line: node.getStartLineNumber(),
            description: 'Test catches errors but only logs them without assertion',
          });
        }
        // Catch without expect/assert
        else if (!catchText.includes('expect') && !catchText.includes('assert') && !catchText.includes('throw')) {
          antiPatterns.push({
            type: 'error_swallowing',
            line: node.getStartLineNumber(),
            description: 'Test catches errors without asserting on them',
          });
        }
      }
    }
  });

  // Check for permissive assertions
  if (/expect.*status.*\.\s*toBe\s*\(\s*20[0-9]\s*\|\|/.test(fullText) ||
      /expect.*\.(toBeOneOf|toBeIn)\s*\(/.test(fullText) ||
      /expect.*\|\|.*expect/.test(fullText)) {
    antiPatterns.push({
      type: 'permissive_assertion',
      line: testNode.getStartLineNumber(),
      description: 'Test uses permissive assertions that accept multiple values',
    });
  }

  // Check for always-passing tests (tautologies)
  const alwaysPassPatterns = [
    // expect(true).toBe(true)
    /expect\s*\(\s*true\s*\)\s*\.(toBe|toEqual)\s*\(\s*true\s*\)/,
    // expect(false).toBe(false)
    /expect\s*\(\s*false\s*\)\s*\.(toBe|toEqual)\s*\(\s*false\s*\)/,
    // expect(1).toBe(1), expect(42).toBe(42), etc.
    /expect\s*\(\s*(\d+)\s*\)\s*\.(toBe|toEqual)\s*\(\s*\1\s*\)/,
    // expect('string').toBe('string')
    /expect\s*\(\s*(['"`])([^'"]+)\1\s*\)\s*\.(toBe|toEqual)\s*\(\s*\1\2\1\s*\)/,
    // expect(anything).toBeDefined() on literal
    /expect\s*\(\s*(['"`][^'"]+['"`]|\d+|true|false)\s*\)\s*\.toBeDefined\s*\(/,
    // expect(anything).toBeTruthy() on truthy literal
    /expect\s*\(\s*(['"`][^'"]+['"`]|[1-9]\d*|true)\s*\)\s*\.toBeTruthy\s*\(/,
  ];

  for (const pattern of alwaysPassPatterns) {
    if (pattern.test(fullText)) {
      antiPatterns.push({
        type: 'always_passes',
        line: testNode.getStartLineNumber(),
        description: 'Test contains tautological assertion that can never fail',
      });
      break; // Only report once per test
    }
  }

  // Check for no assertions (after iterating)
  if (assertionCount === 0) {
    // Exclude tests that are clearly setup or helper tests
    const isSetupTest = /setup|teardown|before|after|helper/i.test(testName);
    if (!isSetupTest) {
      antiPatterns.push({
        type: 'no_assertions',
        line: testNode.getStartLineNumber(),
        description: 'Test has no assertions (expect/assert calls)',
      });
    }
  }

  // Check for mocked SUT (System Under Test)
  const mockedSutPatterns = detectMockedSUT(testNode, sourceFile);
  antiPatterns.push(...mockedSutPatterns);

  return antiPatterns;
}

/**
 * Detect when the module being tested is fully mocked
 *
 * Key insight: Mocking a DEPENDENCY and asserting the result equals the mock value
 * is VALID testing (e.g., mock getServerSession, call validateUser, assert result).
 * We should only flag when:
 * 1. The mocked function IS the function being tested (rare, obvious mistake)
 * 2. The test directly calls the mocked function and asserts on it (no intermediate function)
 */
function detectMockedSUT(testNode: CallExpression, sourceFile: SourceFile): TestAntiPattern[] {
  const antiPatterns: TestAntiPattern[] = [];
  const fileText = sourceFile.getFullText();
  const testText = testNode.getText();

  // Extract what's being tested from test name or describe block
  const _testName = getFirstStringArgument(testNode) ?? '';

  // Find all mocked functions in the file
  const mockedFunctions = new Set<string>();

  // Patterns for mocked function names
  const mockFunctionPatterns = [
    // jest.spyOn(module, 'functionName')
    /jest\.spyOn\s*\([^,]+,\s*['"`](\w+)['"`]\s*\)/g,
    // vi.spyOn(module, 'functionName')
    /vi\.spyOn\s*\([^,]+,\s*['"`](\w+)['"`]\s*\)/g,
    // (functionName as jest.Mock)
    /\((\w+)\s+as\s+jest\.Mock\)/g,
    // mockedFunctionName.mockReturnValue
    /mocked(\w+)\.mock/gi,
    // mockFunctionName (variable named mock*)
    /\b(mock\w+)\.mock(?:ReturnValue|ResolvedValue|Implementation)/gi,
  ];

  for (const pattern of mockFunctionPatterns) {
    const regex = new RegExp(pattern.source, 'gi');
    let match;
    while ((match = regex.exec(fileText)) !== null) {
      if (match[1]) {
        mockedFunctions.add(match[1].toLowerCase());
      }
    }
  }

  // Find functions actually CALLED in the test body (potential SUT)
  const calledFunctions = new Set<string>();
  // Simplified pattern to avoid ReDoS - just find function calls
  const awaitCallPattern = /(\w+)\s*\(/g;
  let callMatch;
  while ((callMatch = awaitCallPattern.exec(testText)) !== null) {
    const fnName = callMatch[1];
    // Exclude common test utilities and assertions
    if (fnName && !['expect', 'describe', 'it', 'test', 'beforeEach', 'afterEach',
        'beforeAll', 'afterAll', 'jest', 'vi', 'mock', 'fn', 'spyOn'].includes(fnName)) {
      calledFunctions.add(fnName.toLowerCase());
    }
  }

  // Check if the test calls a real function (not the mock)
  // If it does, then mocking dependencies is valid
  const callsRealFunction = Array.from(calledFunctions).some(fn =>
    !mockedFunctions.has(fn) && !fn.startsWith('mock') && !fn.startsWith('create')
  );

  // Only flag if the test DIRECTLY calls a mocked function and asserts on it
  // without calling any real function in between
  if (!callsRealFunction) {
    // Check for pattern: call mocked function directly and assert on its return
    // This is a true "mocked SUT" - testing the mock, not real code
    // Simplified pattern to avoid ReDoS
    const hasMockedCall = /=\s*mocked\w+\s*\(/.test(testText);
    const hasExpectOnResult = /expect\s*\(\s*\w+\s*\)/.test(testText);

    if (hasMockedCall && hasExpectOnResult) {
      antiPatterns.push({
        type: 'mocked_sut',
        line: testNode.getStartLineNumber(),
        description: 'Test calls mocked function directly and asserts on it - tests nothing',
      });
    }
  }

  // Check for the clearest anti-pattern: mock returns X, expect exactly X
  // Simplified check: both mockReturnValue/mockResolvedValue AND expect on mock call exist
  const hasMockReturnValue = /\.mock(?:ReturnValue|ResolvedValue)\s*\(/.test(testText);
  const hasExpectOnMockCall = /expect\s*\(\s*mock\w*\s*\(/.test(testText);
  if (hasMockReturnValue && hasExpectOnMockCall) {
    antiPatterns.push({
      type: 'mocked_sut',
      line: testNode.getStartLineNumber(),
      description: 'Test asserts mocked function returns its configured value - tests nothing',
    });
  }

  // Also flag when jest.mock() is used on the same module being tested
  // This is detected by checking if the test file name matches a mocked module
  const testFileName = sourceFile.getBaseName().replace(/\.test\.(ts|js|tsx|jsx)$/, '');
  const mockModulePattern = /jest\.mock\s*\(\s*['"`]\.\/([^'"]+)['"`]/g;
  let moduleMatch;
  while ((moduleMatch = mockModulePattern.exec(fileText)) !== null) {
    const mockedModule = moduleMatch[1]?.toLowerCase();
    if (mockedModule && testFileName.toLowerCase().includes(mockedModule)) {
      antiPatterns.push({
        type: 'mocked_sut',
        line: testNode.getStartLineNumber(),
        description: `Test mocks the module being tested (${mockedModule})`,
      });
      break;
    }
  }

  return antiPatterns;
}
