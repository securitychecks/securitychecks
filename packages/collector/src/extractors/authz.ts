/**
 * Authorization Extractor
 *
 * Extracts authorization call sites from the codebase to verify that
 * auth checks exist at the service layer.
 *
 * Supports multiple detection strategies:
 * 1. Direct function calls (authorize(), checkAuth(), etc.)
 * 2. NestJS decorators (@UseGuards, @Roles, etc.)
 * 3. Express/Fastify middleware patterns
 * 4. Next.js auth patterns (getServerSession, etc.)
 * 5. Class/method decorators for auth
 */

import { SourceFile, Node, CallExpression } from 'ts-morph';
import type { AuthzCall, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

// ============================================================================
// Framework-Specific Auth Patterns
// ============================================================================

/** NestJS guard and decorator patterns */
const NESTJS_AUTH_DECORATORS = [
  '@UseGuards',
  '@Roles',
  '@RequirePermission',
  '@RequirePermissions',
  '@Public',  // Marks as intentionally public
  '@Auth',
  '@Authorized',
  '@RequireAuth',
  '@JwtAuth',
  '@ApiKeyAuth',
];

/** Express/Fastify middleware auth patterns */
const MIDDLEWARE_AUTH_PATTERNS = [
  /\.use\s*\(\s*.*auth/i,
  /\.use\s*\(\s*.*protect/i,
  /\.use\s*\(\s*.*guard/i,
  /\.use\s*\(\s*requireAuth/i,
  /\.use\s*\(\s*authenticate/i,
  /\.use\s*\(\s*passport\./i,
  /\.use\s*\(\s*jwt\./i,
  /\.use\s*\(\s*session/i,
];

/** Next.js auth patterns */
const NEXTJS_AUTH_PATTERNS = [
  'getServerSession',
  'getSession',
  'getToken',
  'withAuth',
  'useSession',
  'auth',  // next-auth v5
  'currentUser',
  'requireAuth',
];

/** tRPC auth patterns */
const TRPC_AUTH_PATTERNS = [
  'protectedProcedure',
  'authedProcedure',
  'adminProcedure',
  'ctx.session',
  'ctx.user',
];

/** Lucia auth patterns */
const LUCIA_AUTH_PATTERNS = [
  'validateRequest',
  'validateSession',
  'lucia.validateSession',
];

/** Clerk auth patterns */
const CLERK_AUTH_PATTERNS = [
  'auth()',
  'currentUser',
  'clerkClient',
  'getAuth',
];

/** SvelteKit auth patterns */
const SVELTEKIT_AUTH_PATTERNS = [
  'locals.user',
  'locals.session',
  'event.locals',
  'getSession',
  'authenticateRequest',
];

/** Nuxt auth patterns */
const NUXT_AUTH_PATTERNS = [
  'event.context.user',
  'event.context.session',
  'useSession',
  'getServerSession',
  'requireAuth',
];

/** Qwik auth patterns */
const QWIK_AUTH_PATTERNS = [
  'cookie.get',
  'useGetCurrentUser',
  'serverSideFetch',
];

/** Astro auth patterns */
const ASTRO_AUTH_PATTERNS = [
  'locals.session',
  'locals.user',
  'Astro.locals',
];

/** Keystone auth patterns */
const KEYSTONE_AUTH_PATTERNS = [
  'context.session',
  'session.itemId',
  'permissions.',
];

/** Solid-Start auth patterns */
const SOLIDSTART_AUTH_PATTERNS = [
  'getSession',
  'useSession',
  'getUser',
];

export async function extractAuthzCalls(options: ExtractorOptions): Promise<AuthzCall[]> {
  const { targetPath, config } = options;
  const authzCalls: AuthzCall[] = [];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return authzCalls;
  }

  const authzFunctions = new Set(config.authzFunctions ?? []);

  // Extract authz calls from each file
  for (const sourceFile of sourceFiles) {
    const calls = extractAuthzCallsFromFile(sourceFile, targetPath, authzFunctions);
    authzCalls.push(...calls);

    // Also extract decorator-based auth
    const decoratorCalls = extractDecoratorAuthFromFile(sourceFile, targetPath);
    authzCalls.push(...decoratorCalls);

    // Also extract middleware auth
    const middlewareCalls = extractMiddlewareAuthFromFile(sourceFile, targetPath);
    authzCalls.push(...middlewareCalls);
  }

  return authzCalls;
}

function extractAuthzCallsFromFile(
  sourceFile: SourceFile,
  targetPath: string,
  authzFunctions: Set<string>
): AuthzCall[] {
  const calls: AuthzCall[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');

  // Find all call expressions
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const functionName = getCallExpressionName(node);
    if (!functionName) return;

    // Check if this is an authz function call
    if (isAuthzCall(functionName, authzFunctions)) {
      const callerFunction = getContainingFunctionName(node);

      calls.push({
        file: relativePath,
        line: node.getStartLineNumber(),
        functionName,
        callerFunction,
        arguments: extractArguments(node),
      });
    }
  });

  return calls;
}

function getCallExpressionName(node: CallExpression): string | undefined {
  const expression = node.getExpression();

  // Simple function call: authorize()
  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }

  // Method call: auth.authorize() or ctx.authorize()
  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getName();
  }

  // Await call: await authorize()
  if (Node.isAwaitExpression(expression)) {
    const inner = expression.getExpression();
    if (Node.isCallExpression(inner)) {
      return getCallExpressionName(inner);
    }
  }

  return undefined;
}

function isAuthzCall(functionName: string, authzFunctions: Set<string>): boolean {
  // Direct match
  if (authzFunctions.has(functionName)) {
    return true;
  }

  // Pattern matching for common authz patterns
  const lowerName = functionName.toLowerCase();
  const authzPatterns = [
    'authorize',
    'requireauth',
    'checkauth',
    'checkpermission',
    'checkaccess',
    'requirepermission',
    'ensureauth',
    'assertauth',
    'verifyauth',
    'canaccess',
    'haspermission',
    'isauthorized',
    'guardaccess',
    'protectedroute',
    'requirerole',
    'checkrole',
  ];

  if (authzPatterns.some((pattern) => lowerName.includes(pattern))) {
    return true;
  }

  // Check Next.js auth patterns
  if (NEXTJS_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check tRPC auth patterns
  if (TRPC_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check Lucia auth patterns
  if (LUCIA_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check Clerk auth patterns
  if (CLERK_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check SvelteKit auth patterns
  if (SVELTEKIT_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check Nuxt auth patterns
  if (NUXT_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check Qwik auth patterns
  if (QWIK_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check Astro auth patterns
  if (ASTRO_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check Keystone auth patterns
  if (KEYSTONE_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  // Check Solid-Start auth patterns
  if (SOLIDSTART_AUTH_PATTERNS.some(p => functionName === p || functionName.includes(p))) {
    return true;
  }

  return false;
}

function getContainingFunctionName(node: CallExpression): string | undefined {
  let current = node.getParent();

  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      return current.getName();
    }
    if (Node.isMethodDeclaration(current)) {
      return current.getName();
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      // Check if it's assigned to a variable
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (Node.isPropertyAssignment(parent)) {
        return parent.getName();
      }
    }

    current = current.getParent();
  }

  return undefined;
}

function extractArguments(node: CallExpression): string[] {
  try {
    return node.getArguments().map((arg) => {
      // Truncate long arguments
      const text = arg.getText();
      return text.length > 100 ? text.substring(0, 100) + '...' : text;
    });
  } catch {
    return [];
  }
}

// ============================================================================
// Decorator-Based Auth Extraction (NestJS, TypeORM, etc.)
// ============================================================================

/**
 * Extract auth decorators from NestJS controllers and other decorated classes
 */
function extractDecoratorAuthFromFile(
  sourceFile: SourceFile,
  targetPath: string
): AuthzCall[] {
  const calls: AuthzCall[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');

  // Find all decorators in the file
  sourceFile.forEachDescendant((node) => {
    // Check for decorator usage
    if (Node.isDecorator(node)) {
      const decoratorText = node.getText();

      // Check if this is an auth decorator
      const isAuthDecorator = NESTJS_AUTH_DECORATORS.some(d =>
        decoratorText.startsWith(d) || decoratorText.includes(d.slice(1))
      );

      if (isAuthDecorator) {
        // Get the decorated element (class or method)
        const parent = node.getParent();
        let decoratedName: string | undefined;

        if (Node.isMethodDeclaration(parent)) {
          decoratedName = parent.getName();
        } else if (Node.isClassDeclaration(parent)) {
          decoratedName = parent.getName();
        }

        calls.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          functionName: decoratorText.split('(')[0]?.replace('@', '') ?? 'decorator',
          callerFunction: decoratedName,
          arguments: extractDecoratorArguments(decoratorText),
        });
      }
    }
  });

  return calls;
}

/**
 * Extract arguments from a decorator string
 */
function extractDecoratorArguments(decoratorText: string): string[] {
  const match = decoratorText.match(/\(([^)]*)\)/);
  if (!match?.[1]) return [];

  // Split by comma, but respect nested parentheses
  const args: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of match[1]) {
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth--;
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) args.push(current.trim());

  return args;
}

// ============================================================================
// Middleware Auth Extraction (Express, Fastify, etc.)
// ============================================================================

/**
 * Extract middleware-based auth patterns from Express/Fastify routes
 */
function extractMiddlewareAuthFromFile(
  sourceFile: SourceFile,
  targetPath: string
): AuthzCall[] {
  const calls: AuthzCall[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');
  const fileText = sourceFile.getFullText();

  // Check for middleware patterns in the file text
  for (const pattern of MIDDLEWARE_AUTH_PATTERNS) {
    const regex = new RegExp(pattern.source, 'gi');
    let match;

    while ((match = regex.exec(fileText)) !== null) {
      // Find the line number for this match
      const beforeMatch = fileText.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      // Extract the middleware name
      const middlewareMatch = match[0].match(/\.use\s*\(\s*([^,)]+)/);
      const middlewareName = middlewareMatch?.[1]?.trim() ?? 'middleware';

      calls.push({
        file: relativePath,
        line: lineNumber,
        functionName: middlewareName,
        callerFunction: 'middleware',
        arguments: [],
      });
    }
  }

  // Also detect route-level auth middleware: router.get('/path', authMiddleware, handler)
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const callText = node.getText();

    // Check for route definitions with auth middleware
    const routeMatch = callText.match(/\.(get|post|put|delete|patch|all)\s*\(/i);
    if (!routeMatch) return;

    // Check if any argument looks like auth middleware
    const args = node.getArguments();
    for (let i = 0; i < args.length; i++) {
      const argText = args[i]?.getText() ?? '';
      const lowerArg = argText.toLowerCase();

      if (
        lowerArg.includes('auth') ||
        lowerArg.includes('protect') ||
        lowerArg.includes('guard') ||
        lowerArg.includes('requireauth') ||
        lowerArg.includes('authenticate')
      ) {
        calls.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          functionName: argText.split('(')[0] ?? 'authMiddleware',
          callerFunction: routeMatch[1],  // get, post, etc.
          arguments: [],
        });
      }
    }
  });

  return calls;
}
