import { readFile, access } from 'fs/promises';
import { join } from 'path';

export interface FrameworkSignal {
  framework: string;
  confidence: number;
  sources: string[];
  version?: string;
}

export interface FrameworkDetection {
  frameworks: string[];
  frameworkVersions: Record<string, string>;
  signals: FrameworkSignal[];
}

const DEPENDENCY_SIGNALS: Record<string, string> = {
  next: 'nextjs',
  '@nestjs/core': 'nestjs',
  '@nestjs/common': 'nestjs',
  express: 'express',
  fastify: 'fastify',
  hono: 'hono',
  '@trpc/server': 'trpc',
  // Koa
  koa: 'koa',
  'koa-router': 'koa',
  '@koa/router': 'koa',
  // Hapi
  '@hapi/hapi': 'hapi',
  hapi: 'hapi',
  // Remix
  '@remix-run/node': 'remix',
  '@remix-run/react': 'remix',
  '@remix-run/serve': 'remix',
  '@remix-run/dev': 'remix',
  '@sveltejs/kit': 'sveltekit',
  nuxt: 'nuxt',
  astro: 'astro',
  // Qwik
  '@builder.io/qwik': 'qwik',
  '@builder.io/qwik-city': 'qwik',
  // Solid-Start
  'solid-start': 'solid-start',
  '@solidjs/start': 'solid-start',
  // Keystone
  '@keystone-6/core': 'keystone',
  '@keystonejs/core': 'keystone',
  '@keystone-next/core': 'keystone',
  // Keystatic
  '@keystatic/core': 'keystatic',
  // Database/ORM
  '@prisma/client': 'prisma',
  prisma: 'prisma',
  'drizzle-orm': 'drizzle',
  typeorm: 'typeorm',
  sequelize: 'sequelize',
  mongoose: 'mongoose',
  '@supabase/supabase-js': 'supabase',
};

const CONFIG_FILE_SIGNALS: Record<string, string[]> = {
  nextjs: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
  nestjs: ['nest-cli.json'],
  sveltekit: ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.ts'],
  nuxt: ['nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.ts'],
  astro: ['astro.config.js', 'astro.config.mjs', 'astro.config.ts'],
  remix: ['remix.config.js', 'remix.config.mjs', 'remix.config.ts'],
  qwik: ['qwik.config.ts', 'qwik.config.js'],
  'solid-start': ['app.config.ts', 'app.config.js'],
  keystone: ['keystone.ts', 'keystone.js'],
  keystatic: ['keystatic.config.ts', 'keystatic.config.tsx', 'keystatic.config.js'],
  prisma: ['prisma/schema.prisma'],
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function accumulateSignal(
  signals: Map<string, FrameworkSignal>,
  framework: string,
  confidence: number,
  source: string,
  version?: string
): void {
  const existing = signals.get(framework);
  if (!existing) {
    signals.set(framework, {
      framework,
      confidence,
      sources: [source],
      version,
    });
    return;
  }

  existing.confidence = Math.min(1, existing.confidence + confidence);
  if (!existing.sources.includes(source)) {
    existing.sources.push(source);
  }
  if (!existing.version && version) {
    existing.version = version;
  }
}

async function readPackageJson(targetPath: string): Promise<Record<string, unknown> | null> {
  const packagePath = join(targetPath, 'package.json');
  if (!(await pathExists(packagePath))) return null;

  try {
    const content = await readFile(packagePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractDependencyMap(pkg: Record<string, unknown>): Record<string, string> {
  const sections = [
    pkg['dependencies'],
    pkg['devDependencies'],
    pkg['peerDependencies'],
    pkg['optionalDependencies'],
  ];

  const deps: Record<string, string> = {};
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    for (const [name, version] of Object.entries(section)) {
      if (typeof version !== 'string') continue;
      deps[name] = version;
    }
  }
  return deps;
}

export async function detectFrameworks(targetPath: string): Promise<FrameworkDetection> {
  const signals = new Map<string, FrameworkSignal>();

  const pkg = await readPackageJson(targetPath);
  if (pkg) {
    const deps = extractDependencyMap(pkg);
    for (const [dep, version] of Object.entries(deps)) {
      const framework = DEPENDENCY_SIGNALS[dep];
      if (!framework) continue;
      accumulateSignal(signals, framework, 0.6, `dep:${dep}`, version);
    }
  }

  for (const [framework, files] of Object.entries(CONFIG_FILE_SIGNALS)) {
    for (const file of files) {
      const filePath = join(targetPath, file);
      if (await pathExists(filePath)) {
        accumulateSignal(signals, framework, 0.8, `config:${file}`);
      }
    }
  }

  const sorted = Array.from(signals.values()).sort((a, b) => a.framework.localeCompare(b.framework));
  const frameworks = sorted.map((signal) => signal.framework);
  const frameworkVersions: Record<string, string> = {};

  for (const signal of sorted) {
    if (signal.version) {
      frameworkVersions[signal.framework] = signal.version;
    }
  }

  return {
    frameworks,
    frameworkVersions,
    signals: sorted,
  };
}
