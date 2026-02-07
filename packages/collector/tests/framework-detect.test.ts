import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectFrameworks } from '../src/frameworks/detect.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sc-detect-'));
}

describe('detectFrameworks', () => {
  describe('dependency detection', () => {
    it('detects Next.js from dependencies', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { next: '^14.0.0', react: '^18.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nextjs');
        expect(result.frameworkVersions['nextjs']).toBe('^14.0.0');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Express from dependencies', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { express: '^4.18.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('express');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects NestJS from @nestjs/core', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: {
              '@nestjs/core': '^10.0.0',
              '@nestjs/common': '^10.0.0',
            },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nestjs');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Fastify from dependencies', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { fastify: '^4.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('fastify');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Hono from dependencies', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { hono: '^4.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('hono');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects SvelteKit from @sveltejs/kit', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            devDependencies: { '@sveltejs/kit': '^2.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('sveltekit');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Remix from @remix-run/*', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: {
              '@remix-run/node': '^2.0.0',
              '@remix-run/react': '^2.0.0',
            },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('remix');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Koa from koa-router', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { koa: '^2.0.0', 'koa-router': '^12.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('koa');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Hapi from @hapi/hapi', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { '@hapi/hapi': '^21.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('hapi');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Qwik from @builder.io/qwik', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: {
              '@builder.io/qwik': '^1.0.0',
              '@builder.io/qwik-city': '^1.0.0',
            },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('qwik');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Solid-Start from @solidjs/start', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { '@solidjs/start': '^1.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('solid-start');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Keystone from @keystone-6/core', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { '@keystone-6/core': '^5.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('keystone');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects tRPC from @trpc/server', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { '@trpc/server': '^10.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('trpc');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Prisma from @prisma/client', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { '@prisma/client': '^5.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('prisma');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('config file detection', () => {
    it('detects Next.js from next.config.js', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));
        writeFileSync(join(dir, 'next.config.js'), 'module.exports = {};');

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nextjs');
        expect(result.signals.find((s) => s.framework === 'nextjs')?.sources).toContain('config:next.config.js');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects NestJS from nest-cli.json', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));
        writeFileSync(join(dir, 'nest-cli.json'), JSON.stringify({}));

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nestjs');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects SvelteKit from svelte.config.js', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));
        writeFileSync(join(dir, 'svelte.config.js'), 'export default {};');

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('sveltekit');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Nuxt from nuxt.config.ts', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));
        writeFileSync(join(dir, 'nuxt.config.ts'), 'export default defineNuxtConfig({});');

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nuxt');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Astro from astro.config.mjs', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));
        writeFileSync(join(dir, 'astro.config.mjs'), 'export default {};');

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('astro');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Prisma from prisma/schema.prisma', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));
        mkdirSync(join(dir, 'prisma'), { recursive: true });
        writeFileSync(join(dir, 'prisma', 'schema.prisma'), 'generator client {}');

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('prisma');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects Keystone from keystone.ts', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));
        writeFileSync(join(dir, 'keystone.ts'), 'export default config({});');

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('keystone');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('multiple frameworks', () => {
    it('detects multiple frameworks in a monorepo setup', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: {
              next: '^14.0.0',
              '@nestjs/core': '^10.0.0',
              '@prisma/client': '^5.0.0',
            },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nextjs');
        expect(result.frameworks).toContain('nestjs');
        expect(result.frameworks).toContain('prisma');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('accumulates confidence from multiple sources', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            dependencies: { next: '^14.0.0' },
          })
        );
        writeFileSync(join(dir, 'next.config.js'), 'module.exports = {};');

        const result = await detectFrameworks(dir);
        const nextSignal = result.signals.find((s) => s.framework === 'nextjs');
        expect(nextSignal?.confidence).toBeGreaterThan(0.6); // Both dep and config
        expect(nextSignal?.sources).toHaveLength(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('edge cases', () => {
    it('handles missing package.json gracefully', async () => {
      const dir = createTempDir();
      try {
        const result = await detectFrameworks(dir);
        expect(result.frameworks).toEqual([]);
        expect(result.signals).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('handles invalid package.json gracefully', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), 'invalid json {{{');

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('handles empty package.json', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({}));

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects from devDependencies', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            devDependencies: { next: '^14.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nextjs');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('detects from peerDependencies', async () => {
      const dir = createTempDir();
      try {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            peerDependencies: { next: '^14.0.0' },
          })
        );

        const result = await detectFrameworks(dir);
        expect(result.frameworks).toContain('nextjs');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
