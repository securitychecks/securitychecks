import type { AuditConfig } from '../types.js';

interface FrameworkProfile {
  exclude?: string[];
}

const FRAMEWORK_PROFILES: Record<string, FrameworkProfile> = {
  nextjs: {
    exclude: ['**/.next/**', '**/.vercel/**', '**/out/**'],
  },
  nuxt: {
    exclude: ['**/.nuxt/**', '**/.output/**'],
  },
  sveltekit: {
    exclude: ['**/.svelte-kit/**'],
  },
  astro: {
    exclude: ['**/.astro/**'],
  },
  remix: {
    exclude: ['**/.cache/**', '**/build/**', '**/public/build/**'],
  },
  nestjs: {
    exclude: ['**/dist/**'],
  },
  qwik: {
    exclude: ['**/.qwik/**', '**/dist/**', '**/server/**/@qwik*/**'],
  },
  'solid-start': {
    exclude: ['**/.solid/**', '**/.vinxi/**', '**/dist/**'],
  },
  keystone: {
    exclude: ['**/.keystone/**'],
  },
  keystatic: {
    exclude: ['**/.keystatic/**'],
  },
  prisma: {
    exclude: ['**/prisma/generated/**', '**/.prisma/**', '**/prisma/client/**'],
  },
};

export function getFrameworkExcludes(frameworks: string[]): string[] {
  const excludes: string[] = [];
  for (const framework of frameworks) {
    const profile = FRAMEWORK_PROFILES[framework.toLowerCase()];
    if (!profile?.exclude) continue;
    excludes.push(...profile.exclude);
  }
  return excludes;
}

function mergeUnique(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  const merged = [...base];
  for (const entry of extra) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    merged.push(entry);
  }
  return merged;
}

export function applyFrameworkProfiles(config: AuditConfig, frameworks: string[]): AuditConfig {
  if (frameworks.length === 0) {
    return config;
  }

  const extraExclude = getFrameworkExcludes(frameworks);

  if (extraExclude.length === 0) {
    return config;
  }

  return {
    ...config,
    exclude: mergeUnique(config.exclude ?? [], extraExclude),
  };
}
