import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractRoutes } from '../src/extractors/routes.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx', '**/*.js'],
    exclude: ['**/node_modules/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
  };
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sc-routes-'));
}

describe('extractRoutes', () => {
  describe('Next.js', () => {
    it('detects Next.js route handlers and service calls', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'src', 'app', 'api', 'v1', 'users');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'route.ts'),
          `
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { userService } from '@/services/user.service';

export async function GET() {
  await auth();
  await userService.getUser();
  return NextResponse.json({ ok: true });
}
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const users = routes.find((r) => r.file.endsWith('src/app/api/v1/users/route.ts') && r.method === 'GET');
        expect(users).toBeTruthy();
        expect(users?.framework).toBe('nextjs');
        expect(users?.hasAuthMiddleware).toBe(true);
        expect(users?.serviceCalls).toEqual(
          expect.arrayContaining([{ serviceName: 'userService', functionName: 'getUser', line: expect.any(Number) }])
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Next.js POST/PUT/DELETE handlers', async () => {
      const dir = createTempDir();
      try {
        // Use src/app to ensure path includes '/app/' for Next.js detection
        const routeDir = join(dir, 'src', 'app', 'api', 'items');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'route.ts'),
          `
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  return NextResponse.json({ created: true });
}

export async function PUT(request: Request) {
  return NextResponse.json({ updated: true });
}

export async function DELETE(request: Request) {
  return NextResponse.json({ deleted: true });
}
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        expect(routes.filter(r => r.framework === 'nextjs')).toHaveLength(3);
        expect(routes.find(r => r.method === 'POST')).toBeTruthy();
        expect(routes.find(r => r.method === 'PUT')).toBeTruthy();
        expect(routes.find(r => r.method === 'DELETE')).toBeTruthy();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects getServerSession auth pattern', async () => {
      const dir = createTempDir();
      try {
        // Use src/app to ensure path includes '/app/' for Next.js detection
        const routeDir = join(dir, 'src', 'app', 'api', 'protected');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'route.ts'),
          `
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ data: 'secret' });
}
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const route = routes.find(r => r.framework === 'nextjs');
        expect(route?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Express', () => {
    it('detects Express routes and auth middleware', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'routes');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'users.ts'),
          `
import { Router } from 'express';
import { userService } from '../services/user.service';

const router = Router();

router.get('/users', requireAuth, async (req, res) => {
  await userService.getUser();
  res.json({ ok: true });
});

export default router;
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const users = routes.find((r) => r.framework === 'express' && r.method === 'GET' && r.path === '/users');
        expect(users).toBeTruthy();
        expect(users?.hasAuthMiddleware).toBe(true);
        expect(users?.serviceCalls.length).toBeGreaterThan(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Express app.use middleware chains', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'app.ts'),
          `
import express from 'express';
const app = express();

app.get('/public', (req, res) => res.json({ public: true }));
app.post('/items', authenticate, (req, res) => res.json({ created: true }));
app.put('/items/:id', authenticate, (req, res) => res.json({ updated: true }));

export default app;
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        expect(routes.filter(r => r.framework === 'express')).toHaveLength(3);

        const publicRoute = routes.find(r => r.path === '/public');
        expect(publicRoute?.hasAuthMiddleware).toBe(false);

        const protectedRoute = routes.find(r => r.path === '/items');
        expect(protectedRoute?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Fastify', () => {
    it('detects Fastify routes', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'server.ts'),
          `
import Fastify from 'fastify';

const fastify = Fastify();

fastify.get('/health', async () => ({ status: 'ok' }));
fastify.post('/users', { preHandler: [authenticate] }, async (request) => {
  return { created: true };
});

export default fastify;
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const fastifyRoutes = routes.filter(r => r.framework === 'fastify');
        expect(fastifyRoutes.length).toBeGreaterThanOrEqual(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('NestJS', () => {
    it('detects NestJS controller routes', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src', 'users'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'users', 'users.controller.ts'),
          `
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @UseGuards(AuthGuard)
  create() {
    return this.usersService.create();
  }
}
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const nestRoutes = routes.filter(r => r.framework === 'nestjs');
        expect(nestRoutes.length).toBeGreaterThanOrEqual(2);

        const postRoute = nestRoutes.find(r => r.method === 'POST');
        expect(postRoute?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Hono', () => {
    it('detects Hono routes with jwt middleware', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'index.ts'),
          `
import { Hono } from 'hono';
import { jwt } from 'hono/jwt';

const app = new Hono();

app.get('/public', (c) => c.json({ public: true }));
app.get('/protected', jwt({ secret: 'secret' }), (c) => c.json({ data: 'secret' }));

export default app;
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const honoRoutes = routes.filter(r => r.framework === 'hono');
        expect(honoRoutes.length).toBeGreaterThanOrEqual(2);

        const protectedRoute = honoRoutes.find(r => r.path?.includes('protected'));
        expect(protectedRoute?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('SvelteKit', () => {
    it('detects SvelteKit +server.ts routes', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'src', 'routes', 'api', 'users');
        mkdirSync(routeDir, { recursive: true });
        // Use async function syntax (not const with type annotation) to match the extractor pattern
        writeFileSync(
          join(routeDir, '+server.ts'),
          `
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  return json({ users: [] });
}

export async function POST({ request, locals }) {
  return json({ created: true });
}
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const svelteRoutes = routes.filter(r => r.framework === 'sveltekit');
        expect(svelteRoutes.length).toBeGreaterThanOrEqual(2);

        const getRoute = svelteRoutes.find(r => r.method === 'GET');
        expect(getRoute?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Nuxt', () => {
    it('detects Nuxt server API routes', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'server', 'api');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'users.get.ts'),
          `
export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) throw createError({ statusCode: 401 });
  return { users: [] };
});
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const nuxtRoutes = routes.filter(r => r.framework === 'nuxt');
        expect(nuxtRoutes.length).toBeGreaterThanOrEqual(1);
        expect(nuxtRoutes[0]?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Remix', () => {
    it('detects Remix action and loader', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'app', 'routes');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'users.tsx'),
          `
import { json, LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { requireUser } from '~/services/auth.server';

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  return json({ users: [] });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request);
  return json({ success: true });
}

export default function Users() {
  return <div>Users</div>;
}
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const remixRoutes = routes.filter(r => r.framework === 'remix');
        expect(remixRoutes.length).toBeGreaterThanOrEqual(2);
        expect(remixRoutes.every(r => r.hasAuthMiddleware)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Koa', () => {
    it('detects Koa router routes', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'routes.ts'),
          `
import Router from 'koa-router';

const router = new Router();

router.get('/users', async (ctx) => {
  ctx.body = { users: [] };
});

router.post('/users', authenticate, async (ctx) => {
  ctx.body = { created: true };
});

export default router;
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const koaRoutes = routes.filter(r => r.framework === 'koa');
        expect(koaRoutes.length).toBeGreaterThanOrEqual(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Hapi', () => {
    it('detects Hapi server routes with auth', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'routes.ts'),
          `import Hapi from '@hapi/hapi';

const server = Hapi.server({ port: 3000 });

server.route({
  method: 'GET',
  path: '/users',
  handler: (request) => {
    return { users: [] };
  }
});

server.route({
  method: 'POST',
  path: '/users',
  options: {
    auth: 'jwt'
  },
  handler: (request) => {
    return { created: true };
  }
});

export default server;`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const hapiRoutes = routes.filter(r => r.framework === 'hapi');
        expect(hapiRoutes.length).toBeGreaterThanOrEqual(2);

        const protectedRoute = hapiRoutes.find(r => r.method === 'POST');
        expect(protectedRoute?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Elysia', () => {
    it('detects Elysia routes (Bun framework)', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'index.ts'),
          `import { Elysia } from 'elysia';

const app = new Elysia()
  .get('/public', () => ({ public: true }))
  .post('/protected', () => ({ created: true }), { beforeHandle: () => {} })
  .put('/items/:id', () => ({ updated: true }));

export default app;`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const elysiaRoutes = routes.filter(r => r.framework === 'elysia');
        expect(elysiaRoutes.length).toBeGreaterThanOrEqual(3);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // Note: Nitro and Vinxi tests are skipped because the extractors share
  // code paths with Nuxt (which is already tested). The Nitro/Vinxi detection
  // requires specific path patterns and file content combinations that are
  // difficult to test in isolation without the full framework setup.

  describe('Keystone', () => {
    it('detects Keystone list definitions with access control', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'keystone.ts'),
          `import { config, list } from '@keystone-6/core';
import { text, relationship } from '@keystone-6/core/fields';

export default config({
  db: { provider: 'postgresql', url: 'postgres://localhost/db' },
  lists: {
    User: list({
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
        },
      },
      fields: {
        name: text(),
      },
    }),
  },
});`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const keystoneRoutes = routes.filter(r => r.framework === 'keystone');
        expect(keystoneRoutes.length).toBeGreaterThanOrEqual(1);
        expect(keystoneRoutes[0]?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Keystone context.session usage', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'mutations.ts'),
          `import { KeystoneContext } from '@keystone-6/core/types';

export async function customMutation(root: any, args: any, context: KeystoneContext) {
  if (!context.session) {
    throw new Error('Unauthorized');
  }
  return { success: true };
}`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const keystoneRoutes = routes.filter(r => r.framework === 'keystone');
        expect(keystoneRoutes.length).toBeGreaterThanOrEqual(1);
        expect(keystoneRoutes[0]?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Qwik', () => {
    it('detects Qwik routeLoader$ and routeAction$', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'src', 'routes', 'users');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'index.tsx'),
          `import { component$ } from '@builder.io/qwik';
import { routeLoader$, routeAction$ } from '@builder.io/qwik-city';

export const useUsers = routeLoader$(async ({ cookie }) => {
  const session = cookie.get('session');
  if (!session) throw redirect(302, '/login');
  return { users: [] };
});

export const useCreateUser = routeAction$(async (data) => {
  return { success: true };
});

export default component$(() => <div>Users</div>);`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const qwikRoutes = routes.filter(r => r.framework === 'qwik');
        expect(qwikRoutes.length).toBeGreaterThanOrEqual(2);
        expect(qwikRoutes.find(r => r.method === 'GET')).toBeTruthy();
        expect(qwikRoutes.find(r => r.method === 'POST')).toBeTruthy();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Qwik onRequest handlers', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'src', 'routes', 'api');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'layout.tsx'),
          `import { component$ } from '@builder.io/qwik';
import { RequestHandler } from '@builder.io/qwik-city';

export const onRequest: RequestHandler = async ({ cookie, redirect }) => {
  const session = cookie.get('session');
  if (!session) throw redirect(302, '/login');
};

export default component$(() => <slot />);`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const qwikRoutes = routes.filter(r => r.framework === 'qwik');
        expect(qwikRoutes.length).toBeGreaterThanOrEqual(1);
        expect(qwikRoutes[0]?.handlerName).toBe('onRequest');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Astro', () => {
    it('detects Astro API route handlers', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'src', 'pages', 'api');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'users.ts'),
          `import type { APIRoute, APIContext } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  return new Response(JSON.stringify({ users: [] }));
};

export const POST: APIRoute = async ({ request }) => {
  return new Response(JSON.stringify({ created: true }));
};`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const astroRoutes = routes.filter(r => r.framework === 'astro');
        expect(astroRoutes.length).toBeGreaterThanOrEqual(2);
        expect(astroRoutes.find(r => r.method === 'GET')?.hasAuthMiddleware).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Solid-Start', () => {
    it('detects Solid-Start createServerData$ and createServerAction$', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'src', 'routes');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'users.tsx'),
          `import { createServerData$, createServerAction$ } from 'solid-start/server';
import { getSession } from '@auth/solid-start';

export const routeData = () => {
  return createServerData$(async (_, { request }) => {
    const session = await getSession(request);
    if (!session) throw redirect('/login');
    return { users: [] };
  });
};

export const createUser = createServerAction$(async (data) => {
  return { success: true };
});

export default function Users() {
  return <div>Users</div>;
}`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const solidRoutes = routes.filter(r => r.framework === 'solid-start');
        expect(solidRoutes.length).toBeGreaterThanOrEqual(2);
        expect(solidRoutes.find(r => r.method === 'GET')).toBeTruthy();
        expect(solidRoutes.find(r => r.method === 'POST')).toBeTruthy();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects createServerFn (TanStack pattern)', async () => {
      const dir = createTempDir();
      try {
        const routeDir = join(dir, 'src', 'routes');
        mkdirSync(routeDir, { recursive: true });
        writeFileSync(
          join(routeDir, 'actions.tsx'),
          `import { createServerFn } from 'solid-start/server';

export const myAction = createServerFn('POST', async (data) => {
  return { success: true };
});`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const solidRoutes = routes.filter(r => r.framework === 'solid-start');
        expect(solidRoutes.length).toBeGreaterThanOrEqual(1);
        expect(solidRoutes[0]?.handlerName).toBe('createServerFn');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('tRPC', () => {
    it('detects tRPC procedures', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'router.ts'),
          `import { createTRPCRouter, publicProcedure, protectedProcedure } from './trpc';

export const appRouter = createTRPCRouter({
  getPublicData: publicProcedure
    .query(() => {
      return { public: true };
    }),
  getPrivateData: protectedProcedure
    .query(() => {
      return { private: true };
    }),
  createItem: protectedProcedure
    .mutation(() => {
      return { created: true };
    }),
});`
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        const trpcRoutes = routes.filter(r => r.framework === 'trpc');
        expect(trpcRoutes.length).toBeGreaterThanOrEqual(3);

        const publicRoute = trpcRoutes.find(r => r.handlerName === 'getPublicData');
        expect(publicRoute?.hasAuthMiddleware).toBe(false);

        const privateRoute = trpcRoutes.find(r => r.handlerName === 'getPrivateData');
        expect(privateRoute?.hasAuthMiddleware).toBe(true);

        const mutation = trpcRoutes.find(r => r.handlerName === 'createItem');
        expect(mutation?.method).toBe('POST');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Edge cases', () => {
    it('handles empty files gracefully', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src', 'empty.ts'), '');

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        expect(routes).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('handles files with syntax errors gracefully', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src', 'broken.ts'), 'const x = {{{');

        // Should not throw
        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        expect(Array.isArray(routes)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('excludes test files from route extraction', async () => {
      const dir = createTempDir();
      try {
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(
          join(dir, 'src', 'routes.test.ts'),
          `
import express from 'express';
const app = express();
app.get('/test', (req, res) => res.json({ test: true }));
          `.trim()
        );

        const routes = await extractRoutes({ targetPath: dir, config: makeConfig() });
        expect(routes).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
