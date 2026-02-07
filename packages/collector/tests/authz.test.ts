/**
 * Tests for authorization extractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractAuthzCalls } from '../src/extractors/authz.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
    authzFunctions: ['authorize', 'checkAuth', 'requireAuth'],
    ...overrides,
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('authz extractor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-authz-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('empty project', () => {
    it('returns empty array when no files', async () => {
      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('direct function calls', () => {
    it('detects authorize() call', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export async function getUser(id: string) {
  authorize();
  return db.user.findUnique({ where: { id } });
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((c) => c.functionName === 'authorize')).toBe(true);
    });

    it('detects checkAuth() call', async () => {
      createFile(
        tempDir,
        'src/api.ts',
        `export function handleRequest() {
  checkAuth();
  return { success: true };
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'checkAuth')).toBe(true);
    });

    it('detects requireAuth() call', async () => {
      createFile(
        tempDir,
        'src/handler.ts',
        `export const handler = () => {
  requireAuth();
  return 'ok';
};`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'requireAuth')).toBe(true);
    });

    it('captures caller function name', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function updateUser(id: string, data: any) {
  authorize();
  return db.user.update({ where: { id }, data });
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const call = result.find((c) => c.functionName === 'authorize');
      expect(call?.callerFunction).toBe('updateUser');
    });

    it('captures call arguments', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function deleteProject(projectId: string) {
  authorize('project:delete', projectId);
  return db.project.delete({ where: { id: projectId } });
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const call = result.find((c) => c.functionName === 'authorize');
      expect(call?.arguments).toContain("'project:delete'");
    });

    it('extracts line number', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `// Line 1
// Line 2
export function handler() {
  // Line 4
  authorize(); // Line 5
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const call = result.find((c) => c.functionName === 'authorize');
      expect(call?.line).toBe(5);
    });
  });

  describe('method calls', () => {
    it('detects auth.authorize() call', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  auth.authorize();
  return { ok: true };
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'authorize')).toBe(true);
    });

    it('detects ctx.checkAuth() call', async () => {
      createFile(
        tempDir,
        'src/resolver.ts',
        `export const resolver = {
  Query: {
    user: (_, args, ctx) => {
      ctx.checkAuth();
      return ctx.db.user.findUnique({ where: { id: args.id } });
    }
  }
};`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'checkAuth')).toBe(true);
    });
  });

  describe('awaited calls', () => {
    it('detects await authorize() call', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export async function handler() {
  await authorize();
  return { ok: true };
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'authorize')).toBe(true);
    });
  });

  describe('pattern matching', () => {
    it('detects ensureAuthenticated pattern', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  ensureAuthenticated();
  return { ok: true };
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'ensureAuthenticated')).toBe(true);
    });

    it('detects checkPermission pattern', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  checkPermission('admin');
  return { ok: true };
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'checkPermission')).toBe(true);
    });

    it('detects canAccess pattern', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  if (!canAccess(resource)) throw new Error('Unauthorized');
  return resource;
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'canAccess')).toBe(true);
    });

    it('detects hasPermission pattern', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler(user) {
  if (!hasPermission(user, 'write')) return null;
  return data;
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'hasPermission')).toBe(true);
    });
  });

  describe('Next.js auth patterns', () => {
    it('detects getServerSession', async () => {
      createFile(
        tempDir,
        'src/api/handler.ts',
        `import { getServerSession } from 'next-auth';
export async function GET() {
  const session = await getServerSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ user: session.user });
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'getServerSession')).toBe(true);
    });

    it('detects auth() from next-auth v5', async () => {
      createFile(
        tempDir,
        'src/api/handler.ts',
        `import { auth } from '@/auth';
export async function GET() {
  const session = await auth();
  return Response.json({ session });
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'auth')).toBe(true);
    });
  });

  describe('tRPC auth patterns', () => {
    it('detects authedProcedure call', async () => {
      createFile(
        tempDir,
        'src/trpc/router.ts',
        `export const userRouter = {
  getMe: authedProcedure(({ ctx }) => {
    return ctx.user;
  }),
};`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'authedProcedure')).toBe(true);
    });
  });

  describe('Lucia auth patterns', () => {
    it('detects validateRequest', async () => {
      createFile(
        tempDir,
        'src/auth.ts',
        `export async function getUser() {
  const { user } = await validateRequest();
  return user;
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'validateRequest')).toBe(true);
    });
  });

  describe('NestJS decorator patterns', () => {
    it('detects @UseGuards decorator', async () => {
      createFile(
        tempDir,
        'src/users.controller.ts',
        `import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  @Get()
  findAll() {
    return [];
  }
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'UseGuards')).toBe(true);
    });

    it('detects @Roles decorator', async () => {
      createFile(
        tempDir,
        'src/admin.controller.ts',
        `import { Controller, Get } from '@nestjs/common';
import { Roles } from './roles.decorator';

@Controller('admin')
export class AdminController {
  @Get()
  @Roles('admin')
  getAdminData() {
    return { admin: true };
  }
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName === 'Roles')).toBe(true);
    });

    it('extracts decorator arguments', async () => {
      createFile(
        tempDir,
        'src/controller.ts',
        `@Roles('admin', 'moderator')
export class Controller {}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const call = result.find((c) => c.functionName === 'Roles');
      expect(call?.arguments).toContain("'admin'");
      expect(call?.arguments).toContain("'moderator'");
    });
  });

  describe('middleware patterns', () => {
    it('detects .use(authMiddleware) pattern', async () => {
      createFile(
        tempDir,
        'src/app.ts',
        `import express from 'express';
const app = express();
app.use(authMiddleware);
app.get('/users', (req, res) => res.json([]))
`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName.includes('auth'))).toBe(true);
    });

    it('detects .use(protect) pattern', async () => {
      createFile(
        tempDir,
        'src/routes.ts',
        `router.use(protect);
router.get('/secure', handler);`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName.includes('protect'))).toBe(true);
    });

    it('detects route-level auth middleware', async () => {
      createFile(
        tempDir,
        'src/routes.ts',
        `router.get('/users', authMiddleware, (req, res) => {
  res.json([]);
});`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName.includes('auth'))).toBe(true);
    });

    it('detects authenticate middleware in post route', async () => {
      createFile(
        tempDir,
        'src/routes.ts',
        `router.post('/data', authenticate, (req, res) => {
  res.json({ created: true });
});`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.some((c) => c.functionName.includes('authenticate'))).toBe(true);
    });
  });

  describe('arrow functions', () => {
    it('captures caller from arrow function variable', async () => {
      createFile(
        tempDir,
        'src/handler.ts',
        `const myHandler = async () => {
  authorize();
  return data;
};`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const call = result.find((c) => c.functionName === 'authorize');
      expect(call?.callerFunction).toBe('myHandler');
    });

    it('captures caller from property assignment', async () => {
      createFile(
        tempDir,
        'src/handlers.ts',
        `export const handlers = {
  getUser: async () => {
    authorize();
    return user;
  }
};`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const call = result.find((c) => c.functionName === 'authorize');
      expect(call?.callerFunction).toBe('getUser');
    });
  });

  describe('multiple files', () => {
    it('extracts from multiple files', async () => {
      createFile(
        tempDir,
        'src/users.ts',
        `export function getUsers() {
  authorize('users:read');
  return [];
}`
      );
      createFile(
        tempDir,
        'src/projects.ts',
        `export function getProjects() {
  checkAuth();
  return [];
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.some((c) => c.file.includes('users'))).toBe(true);
      expect(result.some((c) => c.file.includes('projects'))).toBe(true);
    });
  });

  describe('custom authzFunctions config', () => {
    it('detects custom auth function', async () => {
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  myCustomAuthCheck();
  return data;
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig({
          authzFunctions: ['myCustomAuthCheck'],
        }),
      });

      expect(result.some((c) => c.functionName === 'myCustomAuthCheck')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles long arguments', async () => {
      const longArg = 'x'.repeat(150);
      createFile(
        tempDir,
        'src/service.ts',
        `export function handler() {
  authorize('${longArg}');
  return data;
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const call = result.find((c) => c.functionName === 'authorize');
      // Arguments should be truncated
      expect(call?.arguments[0]?.length).toBeLessThanOrEqual(103); // 100 + "..."
    });

    it('handles files without auth calls', async () => {
      createFile(
        tempDir,
        'src/utils.ts',
        `export function add(a: number, b: number) {
  return a + b;
}`
      );

      const result = await extractAuthzCalls({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.filter((c) => c.file.includes('utils'))).toHaveLength(0);
    });
  });
});
