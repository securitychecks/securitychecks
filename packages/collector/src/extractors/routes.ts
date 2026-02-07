/* eslint-disable max-lines */
/**
 * Route Extractor
 *
 * Extracts route definitions and maps them to service calls.
 * This enables the SERVICE_LAYER checker to verify that routes
 * with auth middleware are calling services that enforce auth.
 *
 * Supports:
 * - Express routes (app.get, router.post, etc.)
 * - Next.js API routes (export async function GET/POST)
 * - Next.js App Router (route.ts with export)
 * - Fastify routes (fastify.get, etc.)
 * - tRPC procedures
 * - NestJS controllers
 */

import { SourceFile, Node } from 'ts-morph';
import type { ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

export interface RouteEntry {
  file: string;
  line: number;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL' | 'OPTIONS' | 'HEAD';
  path?: string;
  handlerName?: string;
  // Auth detection
  hasAuthMiddleware: boolean;
  authMiddleware?: string[];
  // Service calls made by this route
  serviceCalls: Array<{
    serviceName: string;
    functionName: string;
    line: number;
  }>;
  // Framework detection
  framework:
    | 'express'
    | 'fastify'
    | 'nextjs'
    | 'trpc'
    | 'nestjs'
    | 'hono'
    | 'sveltekit'
    | 'nuxt'
    | 'qwik'
    | 'astro'
    | 'solid-start'
    | 'keystone'
    | 'remix'
    | 'koa'
    | 'hapi'
    | 'elysia'
    | 'nitro'
    | 'vinxi'
    | 'unknown';
}

// Express/Fastify route patterns
const ROUTE_METHOD_PATTERNS = [
  /\.(get|post|put|delete|patch|all|options|head)\s*\(/i,
];

// Express/Fastify auth middleware patterns
const AUTH_MIDDLEWARE_PATTERNS = [
  /auth/i,
  /protect/i,
  /guard/i,
  /requireAuth/i,
  /authenticate/i,
  /isAuthenticated/i,
  /ensureAuth/i,
  /checkAuth/i,
  /verifyToken/i,
  /jwt/i,
  /passport/i,
  /session/i,
];

// Next.js auth patterns in route handlers
const NEXTJS_AUTH_PATTERNS = [
  /getServerSession/,
  /getSession/,
  /auth\(\)/,
  /currentUser/,
  /requireAuth/,
  /withAuth/,
];

// Hono auth middleware patterns
const HONO_AUTH_PATTERNS = [
  // Built-in Hono middleware
  /jwt\(/,
  /bearerAuth\(/,
  /basicAuth\(/,
  /jwtPayload/,
  /verifyWithJwks/,
  // @hono/auth-js
  /verifyAuth\(/,
  /getAuthUser\(/,
  /authHandler\(/,
  /c\.get\(['"`]authUser['"`]\)/,
  // @hono/session
  /useSession\(/,
  /c\.get\(['"`]session['"`]\)/,
  // @hono/clerk-auth
  /clerkAuth\(/,
  /clerkMiddleware\(/,
  /getAuth\(/,
  // @hono/firebase-auth
  /firebaseAuth\(/,
  /verifyIdToken/,
  // @hono/oidc-auth
  /oidcAuth\(/,
  /oidcAuthMiddleware/,
  // Common context patterns
  /c\.get\(['"`]user['"`]\)/,
  /c\.get\(['"`]jwtPayload['"`]\)/,
  /c\.var\.user/,
  /c\.var\.session/,
  // Import patterns
  /@hono\/auth-js/,
  /@hono\/clerk-auth/,
  /@hono\/firebase-auth/,
  /@hono\/oidc-auth/,
  /@hono\/session/,
  /hono\/jwt/,
  /hono\/bearer-auth/,
  /hono\/basic-auth/,
];

// Service call patterns (importing and calling services)
const SERVICE_IMPORT_PATTERNS = [
  /from\s+['"`].*service/i,
  /from\s+['"`].*services/i,
  /from\s+['"`]@\/services/i,
  /from\s+['"`]~\/services/i,
];

export async function extractRoutes(options: ExtractorOptions): Promise<RouteEntry[]> {
  const { targetPath, config } = options;
  const routes: RouteEntry[] = [];

  // Find route-related files
  const routePatterns = [
    '**/routes/**/*.ts',
    '**/routes/**/*.js',
    '**/api/**/*.ts',
    '**/api/**/*.js',
    '**/app/**/route.ts',
    '**/app/**/route.js',
    '**/pages/api/**/*.ts',
    '**/pages/api/**/*.js',
    '**/controllers/**/*.ts',
    '**/controllers/**/*.js',
    '**/*.controller.ts',
    '**/*.controller.js',
    // SvelteKit
    '**/+server.ts',
    '**/+server.js',
    '**/+page.server.ts',
    '**/+page.server.js',
    '**/hooks.server.ts',
    '**/hooks.server.js',
    // Nuxt
    '**/server/api/**/*.ts',
    '**/server/routes/**/*.ts',
    // Qwik
    '**/src/routes/**/*.tsx',
    '**/routes/**/*.tsx',
    // Astro
    '**/src/pages/api/**/*.ts',
    '**/pages/api/**/*.ts',
    // Keystone
    '**/keystone.ts',
    '**/keystone.js',
    // Remix
    '**/app/routes/**/*.tsx',
    '**/app/routes/**/*.ts',
    '**/app/routes/**/*.jsx',
    '**/app/routes/**/*.js',
    // Koa
    '**/routes/**/*.ts',
    '**/routes/**/*.js',
    // Hapi
    '**/routes/**/*.ts',
    '**/routes/**/*.js',
    '**/plugins/**/*.ts',
    '**/plugins/**/*.js',
    // General lib (for Hapi, Koa, Express backends)
    '**/lib/**/*.ts',
    '**/lib/**/*.js',
    // Common backend entry points (Express, Koa, Hapi, Fastify)
    '**/app.ts',
    '**/app.js',
    '**/server.ts',
    '**/server.js',
    '**/index.ts',
    '**/index.js',
    // Fastify
    '**/fastify/**/*.ts',
    '**/fastify/**/*.js',
    // Elysia (Bun framework)
    '**/src/**/*.ts',
    // Nitro (standalone)
    '**/server/api/**/*.ts',
    '**/server/routes/**/*.ts',
    '**/server/middleware/**/*.ts',
    // Vinxi
    '**/app/server/**/*.ts',
    '**/app/api/**/*.ts',
  ];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: routePatterns,
  });

  if (sourceFiles.length === 0) {
    return routes;
  }

  for (const sourceFile of sourceFiles) {
    const fileRoutes = extractRoutesFromFile(sourceFile, targetPath);
    routes.push(...fileRoutes);
  }

  return routes;
}

function extractRoutesFromFile(sourceFile: SourceFile, targetPath: string): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');
  const fileText = sourceFile.getFullText();

  // Detect framework
  const framework = detectFramework(relativePath, fileText);

  // Extract service imports for later matching
  const serviceImports = extractServiceImports(sourceFile);

  // Handle different frameworks
  if (framework === 'nextjs') {
    const nextRoutes = extractNextJsRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...nextRoutes);
  } else if (framework === 'express' || framework === 'fastify' || framework === 'hono') {
    const expressRoutes = extractExpressRoutes(sourceFile, relativePath, serviceImports, framework);
    routes.push(...expressRoutes);
  } else if (framework === 'nestjs') {
    const nestRoutes = extractNestJsRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...nestRoutes);
  } else if (framework === 'trpc') {
    const trpcRoutes = extractTrpcRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...trpcRoutes);
  } else if (framework === 'sveltekit') {
    const sveltekitRoutes = extractSvelteKitRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...sveltekitRoutes);
  } else if (framework === 'nuxt') {
    const nuxtRoutes = extractNuxtRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...nuxtRoutes);
  } else if (framework === 'qwik') {
    const qwikRoutes = extractQwikRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...qwikRoutes);
  } else if (framework === 'astro') {
    const astroRoutes = extractAstroRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...astroRoutes);
  } else if (framework === 'solid-start') {
    const solidRoutes = extractSolidStartRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...solidRoutes);
  } else if (framework === 'keystone') {
    const keystoneRoutes = extractKeystoneRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...keystoneRoutes);
  } else if (framework === 'remix') {
    const remixRoutes = extractRemixRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...remixRoutes);
  } else if (framework === 'koa') {
    const koaRoutes = extractKoaRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...koaRoutes);
  } else if (framework === 'hapi') {
    const hapiRoutes = extractHapiRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...hapiRoutes);
  } else if (framework === 'elysia') {
    const elysiaRoutes = extractElysiaRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...elysiaRoutes);
  } else if (framework === 'nitro') {
    const nitroRoutes = extractNitroRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...nitroRoutes);
  } else if (framework === 'vinxi') {
    const vinxiRoutes = extractVinxiRoutes(sourceFile, relativePath, serviceImports);
    routes.push(...vinxiRoutes);
  }

  return routes;
}

function detectFramework(
  filePath: string,
  fileText: string
): RouteEntry['framework'] {
  const lowerText = fileText.toLowerCase();

  // SvelteKit - check first (specific file naming)
  if (
    filePath.includes('+server.') ||
    filePath.includes('+page.server.') ||
    filePath.includes('hooks.server.')
  ) {
    return 'sveltekit';
  }

  // Nuxt - defineEventHandler pattern or server/api path
  if (lowerText.includes('defineeventhandler') || lowerText.includes('eventhandler(')) {
    return 'nuxt';
  }
  if (filePath.includes('/server/api/') || filePath.includes('/server/routes/')) {
    return 'nuxt';
  }

  // Qwik - routeLoader$, routeAction$, server$ patterns
  if (
    lowerText.includes('routeloader$') ||
    lowerText.includes('routeaction$') ||
    lowerText.includes('globalaction$') ||
    lowerText.includes('server$(')
  ) {
    return 'qwik';
  }
  if (
    lowerText.includes("from '@builder.io/qwik") ||
    lowerText.includes('from "@builder.io/qwik')
  ) {
    return 'qwik';
  }

  // Astro - APIRoute or APIContext patterns
  if (lowerText.includes('apiroute') || lowerText.includes('apicontext')) {
    return 'astro';
  }
  if (filePath.endsWith('.astro')) {
    return 'astro';
  }

  // Solid-Start - createServerData$, createServerAction$ patterns
  if (
    lowerText.includes('createserverdata$') ||
    lowerText.includes('createserveraction$') ||
    lowerText.includes("from 'solid-start") ||
    lowerText.includes('from "solid-start')
  ) {
    return 'solid-start';
  }

  // Keystone - access control patterns
  if (
    lowerText.includes('@keystone-6') ||
    lowerText.includes('@keystonejs') ||
    lowerText.includes('keystone.ts')
  ) {
    return 'keystone';
  }
  if (lowerText.includes('context.session') && lowerText.includes('access:')) {
    return 'keystone';
  }

  // Remix / React Router v7 - loader/action exports
  if (
    lowerText.includes('@remix-run/') ||
    lowerText.includes('from "remix"') ||
    lowerText.includes("from 'remix'") ||
    lowerText.includes('from "react-router"') ||
    lowerText.includes("from 'react-router'") ||
    lowerText.includes('route.loaderargs') ||
    lowerText.includes('route.actionargs')
  ) {
    return 'remix';
  }
  if (filePath.includes('/app/routes/') && (
      fileText.includes('function loader') ||
      fileText.includes('function action') ||
      /export const loader/.test(fileText) ||
      /export const action/.test(fileText))) {
    return 'remix';
  }

  // Koa - koa-router or @koa/router patterns (ES6 and CommonJS)
  if (
    lowerText.includes("from 'koa-router'") ||
    lowerText.includes('from "koa-router"') ||
    lowerText.includes("from '@koa/router'") ||
    lowerText.includes('from "@koa/router"') ||
    lowerText.includes("from 'koa'") ||
    lowerText.includes('from "koa"') ||
    lowerText.includes("require('koa-router')") ||
    lowerText.includes('require("koa-router")') ||
    lowerText.includes("require('@koa/router')") ||
    lowerText.includes('require("@koa/router")') ||
    lowerText.includes("require('koa')") ||
    lowerText.includes('require("koa")')
  ) {
    return 'koa';
  }

  // Fastify - check BEFORE Hapi (both use method/path/handler syntax)
  if (
    lowerText.includes("from 'fastify'") ||
    lowerText.includes('from "fastify"') ||
    lowerText.includes("require('fastify')") ||
    lowerText.includes('require("fastify")') ||
    lowerText.includes('fastify.route(') ||
    lowerText.includes('fastify.get(') ||
    lowerText.includes('fastify.post(') ||
    lowerText.includes('fastifyinstance')
  ) {
    return 'fastify';
  }

  // Hapi - @hapi/hapi patterns (must be explicit, not just method/path/handler)
  if (
    lowerText.includes("from '@hapi/hapi'") ||
    lowerText.includes('from "@hapi/hapi"') ||
    lowerText.includes("require('@hapi/hapi')") ||
    lowerText.includes('require("@hapi/hapi")') ||
    lowerText.includes('server.route(')
  ) {
    return 'hapi';
  }

  // Next.js App Router
  if (filePath.includes('/app/') && filePath.includes('route.')) {
    return 'nextjs';
  }

  // Next.js Pages API
  if (filePath.includes('/pages/api/') || filePath.includes('/api/')) {
    if (lowerText.includes('nextapiresponse') || lowerText.includes('nextrequest')) {
      return 'nextjs';
    }
  }

  // NestJS
  if (lowerText.includes('@controller') || lowerText.includes('@nestjs')) {
    return 'nestjs';
  }

  // tRPC
  if (lowerText.includes('trpc') || lowerText.includes('createtrpcrouter')) {
    return 'trpc';
  }

  // Hono
  if (lowerText.includes("from 'hono'") || lowerText.includes('from "hono"')) {
    return 'hono';
  }

  // Elysia (Bun framework)
  if (
    lowerText.includes("from 'elysia'") ||
    lowerText.includes('from "elysia"') ||
    lowerText.includes('@elysiajs/') ||
    lowerText.includes('new elysia(')
  ) {
    return 'elysia';
  }

  // Nitro (standalone, not via Nuxt)
  if (
    (lowerText.includes('defineeventhandler') || lowerText.includes('eventhandler(')) &&
    !lowerText.includes('nuxt') &&
    (lowerText.includes('nitro') || lowerText.includes("from 'h3'") || lowerText.includes('from "h3"'))
  ) {
    return 'nitro';
  }

  // Vinxi
  if (
    lowerText.includes("from 'vinxi'") ||
    lowerText.includes('from "vinxi"') ||
    lowerText.includes('@vinxi/') ||
    lowerText.includes('vinxi.config')
  ) {
    return 'vinxi';
  }

  // Express (default for route-like files)
  if (ROUTE_METHOD_PATTERNS.some((p) => p.test(fileText))) {
    return 'express';
  }

  return 'unknown';
}

function extractServiceImports(sourceFile: SourceFile): Map<string, string> {
  const imports = new Map<string, string>();

  sourceFile.getImportDeclarations().forEach(decl => {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    if (SERVICE_IMPORT_PATTERNS.some(p => p.test(`from '${moduleSpecifier}'`))) {
      decl.getNamedImports().forEach(named => {
        imports.set(named.getName(), moduleSpecifier);
      });
      const defaultImport = decl.getDefaultImport();
      if (defaultImport) {
        imports.set(defaultImport.getText(), moduleSpecifier);
      }
    }
  });

  return imports;
}

function extractNextJsRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Look for exported HTTP method handlers
  const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];

  for (const method of httpMethods) {
    // Check for: export async function GET/POST/etc
    const funcPattern = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\s*\\(`, 'i');
    // Check for: export const GET = ...
    const constPattern = new RegExp(`export\\s+const\\s+${method}\\s*=`, 'i');

    if (funcPattern.test(fileText) || constPattern.test(fileText)) {
      // Find the function node
      let line = 1;
      const match = fileText.match(funcPattern) || fileText.match(constPattern);
      if (match) {
        line = fileText.slice(0, match.index).split('\n').length;
      }

      // Check for auth patterns in the function
      const hasAuth = NEXTJS_AUTH_PATTERNS.some(p => p.test(fileText));
      const authPatterns = NEXTJS_AUTH_PATTERNS
        .filter(p => p.test(fileText))
        .map(p => p.source);

      // Extract service calls
      const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

      routes.push({
        file,
        line,
        method: method as RouteEntry['method'],
        handlerName: method,
        hasAuthMiddleware: hasAuth,
        authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
        serviceCalls,
        framework: 'nextjs',
      });
    }
  }

  return routes;
}

function extractExpressRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>,
  framework: 'express' | 'fastify' | 'hono'
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for Hono auth imports at file level
  const hasHonoAuthImports = framework === 'hono' &&
    HONO_AUTH_PATTERNS.some(p => p.test(fileText));

  sourceFile.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const callText = node.getText();

    // Check for fastify.route({ method, path, handler }) pattern
    if (framework === 'fastify' && callText.includes('.route(')) {
      const methodMatch = callText.match(/method\s*:\s*['"`](\w+)['"`]/i);
      const pathMatch = callText.match(/path\s*:\s*['"`]([^'"`]*)['"`]/i);

      if (methodMatch && pathMatch) {
        const method = methodMatch[1]?.toUpperCase() as RouteEntry['method'];
        const path = pathMatch[1];
        const line = node.getStartLineNumber();

        // Check for auth in route config
        const hasAuth = /auth\s*:\s*['"`]\w+['"`]/.test(callText) ||
                        /auth\s*:\s*\{/.test(callText) ||
                        /preHandler\s*:/.test(callText);

        const serviceCalls = extractServiceCallsFromHandler(node, serviceImports);

        routes.push({
          file,
          line,
          method,
          path,
          hasAuthMiddleware: hasAuth,
          authMiddleware: hasAuth ? ['route-config'] : undefined,
          serviceCalls,
          framework,
        });
        return;
      }
    }

    // Standard .get(), .post() etc patterns
    const routeMatch = callText.match(/\.(get|post|put|delete|patch|all|options|head)\s*\(\s*['"`]([^'"`]*)['"`]/i);

    if (routeMatch) {
      const method = routeMatch[1]?.toUpperCase() as RouteEntry['method'];
      const path = routeMatch[2];
      const line = node.getStartLineNumber();

      // Check for auth middleware in the route arguments
      const args = node.getArguments();
      const authMiddleware: string[] = [];
      let hasAuth = hasHonoAuthImports; // Start with file-level Hono auth imports

      for (const arg of args) {
        const argText = arg.getText();
        // Check general auth patterns
        if (AUTH_MIDDLEWARE_PATTERNS.some(p => p.test(argText))) {
          hasAuth = true;
          const middlewareName = argText.split('(')[0]?.trim();
          if (middlewareName) {
            authMiddleware.push(middlewareName);
          }
        }
        // Check Hono-specific auth patterns
        if (framework === 'hono' && HONO_AUTH_PATTERNS.some(p => p.test(argText))) {
          hasAuth = true;
          const middlewareName = argText.split('(')[0]?.trim();
          if (middlewareName && !authMiddleware.includes(middlewareName)) {
            authMiddleware.push(middlewareName);
          }
        }
      }

      // Extract service calls from the handler
      const serviceCalls = extractServiceCallsFromHandler(node, serviceImports);

      routes.push({
        file,
        line,
        method,
        path,
        hasAuthMiddleware: hasAuth,
        authMiddleware: authMiddleware.length > 0 ? authMiddleware : undefined,
        serviceCalls,
        framework,
      });
    }
  });

  return routes;
}

function extractNestJsRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];

  // Build a map of class-level auth guards
  const classAuthMap = new Map<string, { hasAuth: boolean; authMiddleware: string[] }>();

  sourceFile.forEachDescendant(node => {
    if (!Node.isClassDeclaration(node)) return;
    const className = node.getName();
    if (!className) return;

    let hasClassAuth = false;
    const classAuthMiddleware: string[] = [];

    for (const decorator of node.getDecorators()) {
      const decoratorText = decorator.getText();
      if (/@UseGuards/.test(decoratorText) || /@Roles/.test(decoratorText) ||
          /@Auth/.test(decoratorText) || /@RequirePermission/.test(decoratorText)) {
        hasClassAuth = true;
        classAuthMiddleware.push(decoratorText.match(/@(\w+)/)?.[1] ?? 'Guard');
      }
    }

    classAuthMap.set(className, { hasAuth: hasClassAuth, authMiddleware: classAuthMiddleware });
  });

  // Find methods with HTTP decorators
  sourceFile.forEachDescendant(node => {
    if (!Node.isMethodDeclaration(node)) return;

    // Get class-level auth info
    const parentClass = node.getParent();
    let classAuth = { hasAuth: false, authMiddleware: [] as string[] };
    if (Node.isClassDeclaration(parentClass)) {
      const className = parentClass.getName();
      if (className && classAuthMap.has(className)) {
        classAuth = classAuthMap.get(className)!;
      }
    }

    const decorators = node.getDecorators();
    let httpMethod: RouteEntry['method'] | null = null;
    let path: string | undefined;
    let hasAuth = classAuth.hasAuth; // Start with class-level auth
    const authMiddleware: string[] = [...classAuth.authMiddleware];

    for (const decorator of decorators) {
      const decoratorText = decorator.getText();

      // HTTP method decorators
      const methodMatch = decoratorText.match(/@(Get|Post|Put|Delete|Patch|All|Options|Head)\s*\(([^)]*)\)/i);
      if (methodMatch) {
        httpMethod = methodMatch[1]?.toUpperCase() as RouteEntry['method'];
        path = methodMatch[2]?.replace(/['"]/g, '').trim() || undefined;
      }

      // Auth decorators
      if (/@UseGuards/.test(decoratorText) || /@Roles/.test(decoratorText) ||
          /@Auth/.test(decoratorText) || /@RequirePermission/.test(decoratorText)) {
        hasAuth = true;
        authMiddleware.push(decoratorText.match(/@(\w+)/)?.[1] ?? 'Guard');
      }
    }

    if (httpMethod) {
      const line = node.getStartLineNumber();
      const serviceCalls = extractServiceCallsFromHandler(node, serviceImports);

      routes.push({
        file,
        line,
        method: httpMethod,
        path,
        handlerName: node.getName(),
        hasAuthMiddleware: hasAuth,
        authMiddleware: authMiddleware.length > 0 ? authMiddleware : undefined,
        serviceCalls,
        framework: 'nestjs',
      });
    }
  });

  return routes;
}

function extractTrpcRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];

  sourceFile.forEachDescendant(node => {
    if (!Node.isPropertyAssignment(node)) return;

    const name = node.getName();
    const value = node.getInitializer();
    if (!value) return;

    const valueText = value.getText();

    // Check if it's a procedure
    if (valueText.includes('Procedure') || valueText.includes('.query') || valueText.includes('.mutation')) {
      const line = node.getStartLineNumber();
      const isProtected = /protectedProcedure|authedProcedure|adminProcedure/.test(valueText);
      const isQuery = valueText.includes('.query');

      const serviceCalls = extractServiceCallsFromHandler(node, serviceImports);

      routes.push({
        file,
        line,
        method: isQuery ? 'GET' : 'POST',
        path: name,
        handlerName: name,
        hasAuthMiddleware: isProtected,
        authMiddleware: isProtected ? ['protectedProcedure'] : undefined,
        serviceCalls,
        framework: 'trpc',
      });
    }
  });

  return routes;
}

function extractServiceCalls(
  sourceFile: SourceFile,
  serviceImports: Map<string, string>
): RouteEntry['serviceCalls'] {
  const calls: RouteEntry['serviceCalls'] = [];

  sourceFile.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expression = node.getExpression();
    let serviceName: string | undefined;
    let functionName: string | undefined;

    // service.function() pattern
    if (Node.isPropertyAccessExpression(expression)) {
      const objectName = expression.getExpression().getText();
      if (serviceImports.has(objectName)) {
        serviceName = objectName;
        functionName = expression.getName();
      }
    }

    // Imported function call
    if (Node.isIdentifier(expression)) {
      const name = expression.getText();
      if (serviceImports.has(name)) {
        serviceName = serviceImports.get(name)?.split('/').pop() ?? 'service';
        functionName = name;
      }
    }

    if (serviceName && functionName) {
      calls.push({
        serviceName,
        functionName,
        line: node.getStartLineNumber(),
      });
    }
  });

  return calls;
}

function extractServiceCallsFromHandler(
  node: Node,
  serviceImports: Map<string, string>
): RouteEntry['serviceCalls'] {
  const calls: RouteEntry['serviceCalls'] = [];

  node.forEachDescendant(child => {
    if (!Node.isCallExpression(child)) return;

    const expression = child.getExpression();
    let serviceName: string | undefined;
    let functionName: string | undefined;

    // service.function() pattern
    if (Node.isPropertyAccessExpression(expression)) {
      const objectName = expression.getExpression().getText();
      if (serviceImports.has(objectName) ||
          objectName.toLowerCase().includes('service')) {
        serviceName = objectName;
        functionName = expression.getName();
      }
    }

    // Imported function call
    if (Node.isIdentifier(expression)) {
      const name = expression.getText();
      if (serviceImports.has(name)) {
        serviceName = serviceImports.get(name)?.split('/').pop() ?? 'service';
        functionName = name;
      }
    }

    if (serviceName && functionName) {
      calls.push({
        serviceName,
        functionName,
        line: child.getStartLineNumber(),
      });
    }
  });

  return calls;
}

// ============================================================================
// Framework-specific auth patterns
// ============================================================================

const SVELTEKIT_AUTH_PATTERNS = [
  /locals\.user/,
  /locals\.session/,
  /locals\.isAdmin/,
  /event\.locals/,
  /getSession\(/,
  /authenticateRequest\(/,
  /authCondition\(/,
];

const NUXT_AUTH_PATTERNS = [
  /useSession\(/,
  /getServerSession\(/,
  /event\.context\.user/,
  /event\.context\.session/,
  /requireAuth\(/,
  /protectRoute\(/,
  /getCookie.*auth/i,
  /verifyToken\(/,
];

const QWIK_AUTH_PATTERNS = [
  // Cookie-based auth
  /cookie\.get\s*\(\s*['"`].*auth/i,
  /cookie\.get\s*\(\s*['"`].*session/i,
  /cookie\.get\s*\(\s*['"`].*token/i,
  /Authorization.*Bearer/,
  // Auth.js integration (@auth/qwik)
  /QwikAuth\$/,
  /useSession\(/,
  /useSignIn\(/,
  /useSignOut\(/,
  /getSession\(/,
  /@auth\/qwik/,
  /@auth\/core\/jwt/,
  /AUTH_SECRET/,
  // Middleware/sharedMap patterns
  /sharedMap\.get\s*\(\s*['"`]user['"`]\)/,
  /sharedMap\.get\s*\(\s*['"`]session['"`]\)/,
  /requestEvent\.sharedMap/,
  // Custom auth hooks
  /useGetCurrentUser/,
  /useAuthSession/,
  /useAuth\(/,
  /serverSideFetch\(/,
  // Plugin auth patterns
  /plugin@auth/,
  /onRequest.*auth/i,
];

const ASTRO_AUTH_PATTERNS = [
  /locals\.session/,
  /locals\.user/,
  /Astro\.locals/,
  /context\.locals/,
  /getSession\(/,
  /cookies\.get\s*\(\s*['"`].*auth/i,
];

const SOLIDSTART_AUTH_PATTERNS = [
  // @auth/solid-start (Auth.js integration)
  /getSession\(/,
  /useSession\(/,
  /authOpts/,
  /@auth\/solid-start/,
  /\[\.\.\.solidauth\]/,
  // Lucia Auth patterns
  /AuthRequest\.validate/,
  /lucia\.validateSession/,
  /lucia\.createSession/,
  /lucia-auth/,
  // Vinxi/TanStack patterns
  /createAuthCallbacks/,
  /useAppSession\(/,
  /createServerFn.*auth/i,
  /vinxi.*session/i,
  // General patterns
  /getUser\(/,
  /getCurrentUser\(/,
  /request\.headers\.get\s*\(\s*['"`]authorization/i,
  /request\.headers\.get\s*\(\s*['"`]cookie/i,
  // Session patterns
  /session\.get\(/,
  /session\.set\(/,
  /validateSession\(/,
  // Cookie-based auth
  /parseCookie/,
  /getCookie\(/,
  // Protected route patterns
  /redirect.*login/i,
  /throw.*401/,
  /throw.*403/,
];

const KEYSTONE_AUTH_PATTERNS = [
  /context\.session/,
  /context\.session\?\./,
  /session\.itemId/,
  /session\?\.itemId/,
  /access:\s*\{/,
  /permissions\./,
  /isAccessAllowed/,
];

// Elysia auth patterns (Bun framework)
const ELYSIA_AUTH_PATTERNS = [
  // @elysiajs/jwt plugin
  /@elysiajs\/jwt/,
  /jwt\.sign/,
  /jwt\.verify/,
  // @elysiajs/bearer
  /@elysiajs\/bearer/,
  /bearer\(/,
  // @elysiajs/cookie
  /@elysiajs\/cookie/,
  /cookie\.auth/,
  /setCookie.*auth/i,
  // Better Auth integration
  /better-auth/,
  /auth\.handler/,
  // Derive middleware patterns
  /isAuthenticated/,
  /derive.*auth/i,
  /derive.*user/i,
  // Common patterns
  /onBeforeHandle.*auth/i,
  /guard\(/,
  /\.macro\(/,
];

// Nitro/h3 auth patterns (Nuxt server engine)
const NITRO_AUTH_PATTERNS = [
  // Event context auth
  /event\.context\.auth/,
  /event\.context\.user/,
  /event\.context\.session/,
  // Utility functions
  /requireAuth\(/,
  /defineRequireAuthEventHandler/,
  /getAuthUser\(/,
  // Header/cookie auth
  /getHeader.*authorization/i,
  /getCookie.*auth/i,
  /getCookie.*session/i,
  // Session
  /getSession\(event/,
  /useSession\(/,
  // h3 utilities
  /createError.*401/,
  /createError.*403/,
  /sendError.*Unauthorized/i,
];

// Vinxi auth patterns (uses Nitro/h3 under the hood)
const VINXI_AUTH_PATTERNS = [
  // Same as Nitro patterns
  /event\.context\.auth/,
  /event\.context\.user/,
  /event\.context\.session/,
  // Vinxi-specific
  /@vinxi\/h3/,
  /vinxi.*session/i,
  /vinxi.*auth/i,
  // Server functions
  /server\$.*auth/i,
  /createServerFn.*auth/i,
  // Common patterns
  /getHeader.*authorization/i,
  /getCookie.*auth/i,
  /requireAuth\(/,
];

// ============================================================================
// SvelteKit extractor
// ============================================================================

function extractSvelteKitRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns
  const hasAuth = SVELTEKIT_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = SVELTEKIT_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // Detect HTTP method exports (+server.ts)
  const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
  for (const method of httpMethods) {
    const funcPattern = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\s*\\(`, 'i');
    const constPattern = new RegExp(`export\\s+const\\s+${method}\\s*=`, 'i');

    if (funcPattern.test(fileText) || constPattern.test(fileText)) {
      let line = 1;
      const match = fileText.match(funcPattern) || fileText.match(constPattern);
      if (match && match.index !== undefined) {
        line = fileText.slice(0, match.index).split('\n').length;
      }

      routes.push({
        file,
        line,
        method: method as RouteEntry['method'],
        handlerName: method,
        hasAuthMiddleware: hasAuth,
        authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
        serviceCalls,
        framework: 'sveltekit',
      });
    }
  }

  // Detect PageServerLoad (+page.server.ts)
  if (/export\s+const\s+load/.test(fileText) || /PageServerLoad/.test(fileText)) {
    let line = 1;
    const match = fileText.match(/export\s+const\s+load/);
    if (match && match.index !== undefined) {
      line = fileText.slice(0, match.index).split('\n').length;
    }

    routes.push({
      file,
      line,
      method: 'GET',
      handlerName: 'load',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'sveltekit',
    });
  }

  // Detect actions (+page.server.ts)
  if (/export\s+const\s+actions/.test(fileText)) {
    let line = 1;
    const match = fileText.match(/export\s+const\s+actions/);
    if (match && match.index !== undefined) {
      line = fileText.slice(0, match.index).split('\n').length;
    }

    routes.push({
      file,
      line,
      method: 'POST',
      handlerName: 'actions',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'sveltekit',
    });
  }

  return routes;
}

// ============================================================================
// Nuxt extractor
// ============================================================================

function extractNuxtRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for defineEventHandler or eventHandler
  if (!/defineEventHandler|eventHandler/.test(fileText)) {
    return routes;
  }

  // Check for auth patterns
  const hasAuth = NUXT_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = NUXT_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Infer method from filename (Nuxt convention: [id].post.ts -> POST)
  const method = inferMethodFromNuxtPath(file);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  let line = 1;
  const match = fileText.match(/defineEventHandler|eventHandler/);
  if (match && match.index !== undefined) {
    line = fileText.slice(0, match.index).split('\n').length;
  }

  routes.push({
    file,
    line,
    method,
    handlerName: 'eventHandler',
    hasAuthMiddleware: hasAuth,
    authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
    serviceCalls,
    framework: 'nuxt',
  });

  return routes;
}

function inferMethodFromNuxtPath(file: string): RouteEntry['method'] {
  // Nuxt convention: [id].post.ts -> POST, [id].get.ts -> GET
  const methodMatch = file.match(/\.(get|post|put|delete|patch)\.ts$/i);
  if (methodMatch && methodMatch[1]) {
    return methodMatch[1].toUpperCase() as RouteEntry['method'];
  }
  return 'GET'; // Default to GET
}

// ============================================================================
// Qwik extractor
// ============================================================================

function extractQwikRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns
  const hasAuth = QWIK_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = QWIK_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // routeLoader$ (GET-like)
  const loaderMatches = fileText.match(/export\s+const\s+\w+\s*=\s*routeLoader\$/g);
  if (loaderMatches) {
    for (const match of loaderMatches) {
      const index = fileText.indexOf(match);
      const line = fileText.slice(0, index).split('\n').length;

      routes.push({
        file,
        line,
        method: 'GET',
        handlerName: 'routeLoader$',
        hasAuthMiddleware: hasAuth,
        authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
        serviceCalls,
        framework: 'qwik',
      });
    }
  }

  // routeAction$ / globalAction$ (POST-like)
  const actionMatches = fileText.match(/export\s+const\s+\w+\s*=\s*(routeAction\$|globalAction\$)/g);
  if (actionMatches) {
    for (const match of actionMatches) {
      const index = fileText.indexOf(match);
      const line = fileText.slice(0, index).split('\n').length;

      routes.push({
        file,
        line,
        method: 'POST',
        handlerName: 'routeAction$',
        hasAuthMiddleware: hasAuth,
        authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
        serviceCalls,
        framework: 'qwik',
      });
    }
  }

  // onRequest, onGet, onPost handlers
  const handlerMethods = ['onRequest', 'onGet', 'onPost', 'onPut', 'onDelete'];
  for (const handler of handlerMethods) {
    const pattern = new RegExp(`export\\s+const\\s+${handler}`, 'i');
    if (pattern.test(fileText)) {
      const match = fileText.match(pattern);
      const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;
      const method =
        handler === 'onRequest' ? 'ALL' : (handler.replace('on', '').toUpperCase() as RouteEntry['method']);

      routes.push({
        file,
        line,
        method,
        handlerName: handler,
        hasAuthMiddleware: hasAuth,
        authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
        serviceCalls,
        framework: 'qwik',
      });
    }
  }

  return routes;
}

// ============================================================================
// Astro extractor
// ============================================================================

function extractAstroRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns
  const hasAuth = ASTRO_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = ASTRO_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // Look for exported HTTP method handlers
  const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  for (const method of httpMethods) {
    const pattern = new RegExp(`export\\s+const\\s+${method}\\s*[:=]`, 'i');
    if (pattern.test(fileText)) {
      const match = fileText.match(pattern);
      const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

      routes.push({
        file,
        line,
        method: method as RouteEntry['method'],
        handlerName: method,
        hasAuthMiddleware: hasAuth,
        authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
        serviceCalls,
        framework: 'astro',
      });
    }
  }

  return routes;
}

// ============================================================================
// Solid-Start extractor
// ============================================================================

function extractSolidStartRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns
  const hasAuth = SOLIDSTART_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = SOLIDSTART_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // createServerData$ (GET-like)
  if (/createServerData\$/.test(fileText)) {
    const match = fileText.match(/createServerData\$/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'GET',
      handlerName: 'createServerData$',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'solid-start',
    });
  }

  // createServerAction$ (POST-like)
  if (/createServerAction\$/.test(fileText)) {
    const match = fileText.match(/createServerAction\$/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'POST',
      handlerName: 'createServerAction$',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'solid-start',
    });
  }

  // server$ (general server function - newer pattern)
  if (/server\$\s*\(/.test(fileText)) {
    const match = fileText.match(/server\$\s*\(/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'POST',
      handlerName: 'server$',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'solid-start',
    });
  }

  // createServerFn (TanStack Start pattern)
  if (/createServerFn\s*\(/.test(fileText)) {
    const match = fileText.match(/createServerFn\s*\(/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'POST',
      handlerName: 'createServerFn',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'solid-start',
    });
  }

  return routes;
}

// ============================================================================
// Keystone extractor
// ============================================================================

function extractKeystoneRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns
  const hasAuth = KEYSTONE_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = KEYSTONE_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // Look for list() definitions with access control
  const listMatches = fileText.match(/list\s*\(\s*\{/g);
  if (listMatches) {
    // Check if there's access control defined
    const hasAccessControl = /access:\s*\{/.test(fileText);

    for (const match of listMatches) {
      const index = fileText.indexOf(match);
      const line = fileText.slice(0, index).split('\n').length;

      routes.push({
        file,
        line,
        method: 'ALL', // Keystone lists handle all CRUD operations
        handlerName: 'list',
        hasAuthMiddleware: hasAccessControl || hasAuth,
        authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
        serviceCalls,
        framework: 'keystone',
      });
    }
  }

  // Look for custom mutations/queries with session checks
  if (/context\.session/.test(fileText) && !listMatches) {
    const match = fileText.match(/context\.session/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'POST',
      handlerName: 'customResolver',
      hasAuthMiddleware: true,
      authMiddleware: ['context.session'],
      serviceCalls,
      framework: 'keystone',
    });
  }

  return routes;
}

// ============================================================================
// Remix extractor
// ============================================================================

const REMIX_AUTH_PATTERNS = [
  /authenticator\.isAuthenticated/,
  /getSession\(/,
  /requireUser\(/,
  /requireUserId\(/,
  /requireAuth\(/,
  /session\.get\s*\(\s*['"`]user/i,
  /session\.get\s*\(\s*['"`]userId/i,
  /request\.headers\.get\s*\(\s*['"`]authorization/i,
  /cookies\.get\s*\(\s*['"`].*session/i,
  /throw\s+redirect\s*\(/,
  /assertUser\(/,
  /sessionStorage\./,
  /authSessionStorage\./,
  /invariantResponse\(/,
];

function extractRemixRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns
  const hasAuth = REMIX_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = REMIX_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // Look for loader function (GET-like)
  // Using simple string matching to avoid unsafe regex
  const hasLoader = fileText.includes('function loader') || /export const loader/.test(fileText);
  if (hasLoader) {
    const loaderMatch = fileText.match(/function loader|export const loader/);
    const line = loaderMatch && loaderMatch.index !== undefined ? fileText.slice(0, loaderMatch.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'GET',
      handlerName: 'loader',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'remix',
    });
  }

  // Look for action function (POST/PUT/DELETE-like)
  const hasAction = fileText.includes('function action') || /export const action/.test(fileText);
  if (hasAction) {
    const actionMatch = fileText.match(/function action|export const action/);
    const line = actionMatch && actionMatch.index !== undefined ? fileText.slice(0, actionMatch.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'POST', // Actions handle POST by default (also PUT, DELETE via form method)
      handlerName: 'action',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'remix',
    });
  }

  return routes;
}

// ============================================================================
// Koa extractor
// ============================================================================

const KOA_AUTH_PATTERNS = [
  /ctx\.state\.user/,
  /ctx\.state\.session/,
  /ctx\.session/,
  /ctx\.isAuthenticated\(\)/,
  /passport\.authenticate/,
  /jwt\(/,
  /koaJwt\(/,
  /requireAuth/,
  /isLoggedIn/,
];

function extractKoaRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns at file level
  const hasFileAuth = KOA_AUTH_PATTERNS.some((p) => p.test(fileText));
  const fileAuthPatterns = KOA_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  sourceFile.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    // Get the expression being called (e.g., router.get or something.get for chaining)
    const expression = node.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) return;

    const methodName = expression.getName().toLowerCase();
    const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head'];
    if (!httpMethods.includes(methodName)) return;

    // Check if this is on a router (either directly or chained)
    const callText = node.getText();
    const isKoaRouter = /router\.(get|post|put|delete|patch|all|options|head)/i.test(callText) ||
                        /\)\s*\.(get|post|put|delete|patch|all|options|head)\s*\(/i.test(callText) ||
                        fileText.includes('@koa/router') ||
                        fileText.includes('koa-router');

    if (!isKoaRouter) return;

    // Extract path from first argument
    const args = node.getArguments();
    if (args.length === 0) return;

    const firstArg = args[0];
    if (!firstArg) return;
    const argText = firstArg.getText();
    const pathMatch = argText.match(/^['"`]([^'"`]*)['"`]$/);
    if (!pathMatch) return;

    const method = methodName.toUpperCase() as RouteEntry['method'];
    const path = pathMatch[1];
    const line = node.getStartLineNumber();

    // Check for auth middleware in the route arguments
    const authMiddleware: string[] = [];
    let hasAuth = hasFileAuth;

    for (const arg of args.slice(1)) {
      const argTxt = arg.getText();
      if (AUTH_MIDDLEWARE_PATTERNS.some(p => p.test(argTxt)) ||
          KOA_AUTH_PATTERNS.some(p => p.test(argTxt))) {
        hasAuth = true;
        const middlewareName = argTxt.split('(')[0]?.trim();
        if (middlewareName) {
          authMiddleware.push(middlewareName);
        }
      }
    }

    const serviceCalls = extractServiceCallsFromHandler(node, serviceImports);

    routes.push({
      file,
      line,
      method,
      path,
      hasAuthMiddleware: hasAuth,
      authMiddleware: authMiddleware.length > 0 ? authMiddleware : (fileAuthPatterns.length > 0 ? fileAuthPatterns : undefined),
      serviceCalls,
      framework: 'koa',
    });
  });

  return routes;
}

// ============================================================================
// Hapi extractor
// ============================================================================

const HAPI_AUTH_PATTERNS = [
  /auth:\s*['"`]\w+['"`]/,
  /auth:\s*\{/,
  /server\.auth\.strategy/,
  /server\.auth\.default/,
  /hapi-auth-jwt2/,
  /hapi-auth-basic/,
  /hapi-auth-cookie/,
  /@hapi\/bell/,
  /credentials/,
];

function extractHapiRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns at file level
  const hasFileAuth = HAPI_AUTH_PATTERNS.some((p) => p.test(fileText));
  const fileAuthPatterns = HAPI_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  sourceFile.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const callText = node.getText();

    // Match server.route({ method: 'GET', path: '/path', handler: ... })
    if (/server\.route\s*\(/.test(callText) || /\.route\s*\(/.test(callText)) {
      // Extract method and path from the route config object
      const methodMatch = callText.match(/method:\s*['"`](\w+)['"`]/i);
      const pathMatch = callText.match(/path:\s*['"`]([^'"`]+)['"`]/);
      const authMatch = callText.match(/auth:\s*(['"`]\w+['"`]|\{[^}]+\}|false)/);

      if (methodMatch && pathMatch) {
        const method = methodMatch[1]?.toUpperCase() as RouteEntry['method'];
        const path = pathMatch[1];
        const line = node.getStartLineNumber();

        // Check if auth is configured
        let hasAuth = hasFileAuth;
        const authMiddleware: string[] = [];

        if (authMatch) {
          const authConfig = authMatch[1];
          if (authConfig && authConfig !== 'false') {
            hasAuth = true;
            authMiddleware.push(authConfig.replace(/['"]/g, ''));
          }
        }

        const serviceCalls = extractServiceCallsFromHandler(node, serviceImports);

        routes.push({
          file,
          line,
          method,
          path,
          hasAuthMiddleware: hasAuth,
          authMiddleware: authMiddleware.length > 0 ? authMiddleware : (fileAuthPatterns.length > 0 ? fileAuthPatterns : undefined),
          serviceCalls,
          framework: 'hapi',
        });
      }
    }
  });

  return routes;
}

// ============================================================================
// Elysia extractor (Bun framework)
// ============================================================================

function extractElysiaRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns at file level
  const hasFileAuth = ELYSIA_AUTH_PATTERNS.some((p) => p.test(fileText));
  const fileAuthPatterns = ELYSIA_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  sourceFile.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const callText = node.getText();

    // Match .get('/path', handler), .post('/path', handler) etc
    const routeMatch = callText.match(/\.(get|post|put|delete|patch|all|options|head)\s*\(\s*['"`]([^'"`]*)['"`]/i);

    if (routeMatch) {
      const method = routeMatch[1]?.toUpperCase() as RouteEntry['method'];
      const path = routeMatch[2];
      const line = node.getStartLineNumber();

      // Check for auth in handlers (derive, guard, etc.)
      const hasAuth = hasFileAuth ||
                      /derive/.test(callText) ||
                      /guard/.test(callText) ||
                      /onBeforeHandle/.test(callText);

      routes.push({
        file,
        line,
        method,
        path,
        hasAuthMiddleware: hasAuth,
        authMiddleware: fileAuthPatterns.length > 0 ? fileAuthPatterns : undefined,
        serviceCalls,
        framework: 'elysia',
      });
    }
  });

  return routes;
}

// ============================================================================
// Nitro extractor (standalone h3/Nitro server)
// ============================================================================

function extractNitroRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns at file level
  const hasAuth = NITRO_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = NITRO_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // Check for defineEventHandler
  if (/defineEventHandler|eventHandler\(/.test(fileText)) {
    // Infer method from filename (e.g., [id].post.ts -> POST)
    let method: RouteEntry['method'] = 'GET';
    const methodMatch = file.match(/\.(get|post|put|delete|patch)\.(ts|js)$/i);
    if (methodMatch?.[1]) {
      method = methodMatch[1].toUpperCase() as RouteEntry['method'];
    }

    // Find line number
    const match = fileText.match(/defineEventHandler|eventHandler\(/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method,
      handlerName: 'defineEventHandler',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'nitro',
    });
  }

  return routes;
}

// ============================================================================
// Vinxi extractor (uses Nitro/h3 under the hood)
// ============================================================================

function extractVinxiRoutes(
  sourceFile: SourceFile,
  file: string,
  serviceImports: Map<string, string>
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const fileText = sourceFile.getFullText();

  // Check for auth patterns at file level
  const hasAuth = VINXI_AUTH_PATTERNS.some((p) => p.test(fileText));
  const authPatterns = VINXI_AUTH_PATTERNS.filter((p) => p.test(fileText)).map((p) => p.source);

  // Extract service calls
  const serviceCalls = extractServiceCalls(sourceFile, serviceImports);

  // Check for defineEventHandler (same as Nitro)
  if (/defineEventHandler|eventHandler\(/.test(fileText)) {
    let method: RouteEntry['method'] = 'GET';
    const methodMatch = file.match(/\.(get|post|put|delete|patch)\.(ts|js)$/i);
    if (methodMatch?.[1]) {
      method = methodMatch[1].toUpperCase() as RouteEntry['method'];
    }

    const match = fileText.match(/defineEventHandler|eventHandler\(/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method,
      handlerName: 'defineEventHandler',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'vinxi',
    });
  }

  // Check for server$ functions
  if (/server\$\s*\(/.test(fileText)) {
    const match = fileText.match(/server\$\s*\(/);
    const line = match && match.index !== undefined ? fileText.slice(0, match.index).split('\n').length : 1;

    routes.push({
      file,
      line,
      method: 'POST',
      handlerName: 'server$',
      hasAuthMiddleware: hasAuth,
      authMiddleware: authPatterns.length > 0 ? authPatterns : undefined,
      serviceCalls,
      framework: 'vinxi',
    });
  }

  return routes;
}
