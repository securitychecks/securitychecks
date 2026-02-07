import { describe, it, expect } from 'vitest';
import { getFrameworkExcludes, applyFrameworkProfiles } from '../src/frameworks/profiles.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(exclude?: string[]): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts'],
    exclude: exclude ?? ['**/node_modules/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
  };
}

describe('getFrameworkExcludes', () => {
  it('returns Next.js excludes', () => {
    const excludes = getFrameworkExcludes(['nextjs']);
    expect(excludes).toContain('**/.next/**');
    expect(excludes).toContain('**/.vercel/**');
  });

  it('returns Nuxt excludes', () => {
    const excludes = getFrameworkExcludes(['nuxt']);
    expect(excludes).toContain('**/.nuxt/**');
    expect(excludes).toContain('**/.output/**');
  });

  it('returns SvelteKit excludes', () => {
    const excludes = getFrameworkExcludes(['sveltekit']);
    expect(excludes).toContain('**/.svelte-kit/**');
  });

  it('returns Astro excludes', () => {
    const excludes = getFrameworkExcludes(['astro']);
    expect(excludes).toContain('**/.astro/**');
  });

  it('returns Remix excludes', () => {
    const excludes = getFrameworkExcludes(['remix']);
    expect(excludes).toContain('**/.cache/**');
    expect(excludes).toContain('**/build/**');
  });

  it('returns NestJS excludes', () => {
    const excludes = getFrameworkExcludes(['nestjs']);
    expect(excludes).toContain('**/dist/**');
  });

  it('returns Qwik excludes', () => {
    const excludes = getFrameworkExcludes(['qwik']);
    expect(excludes).toContain('**/.qwik/**');
  });

  it('returns Solid-Start excludes', () => {
    const excludes = getFrameworkExcludes(['solid-start']);
    expect(excludes).toContain('**/.solid/**');
    expect(excludes).toContain('**/.vinxi/**');
  });

  it('returns Keystone excludes', () => {
    const excludes = getFrameworkExcludes(['keystone']);
    expect(excludes).toContain('**/.keystone/**');
  });

  it('returns Prisma excludes', () => {
    const excludes = getFrameworkExcludes(['prisma']);
    expect(excludes).toContain('**/prisma/generated/**');
    expect(excludes).toContain('**/.prisma/**');
  });

  it('handles case-insensitive framework names', () => {
    const excludes = getFrameworkExcludes(['NextJS', 'NUXT']);
    expect(excludes).toContain('**/.next/**');
    expect(excludes).toContain('**/.nuxt/**');
  });

  it('combines excludes from multiple frameworks', () => {
    const excludes = getFrameworkExcludes(['nextjs', 'prisma']);
    expect(excludes).toContain('**/.next/**');
    expect(excludes).toContain('**/prisma/generated/**');
  });

  it('returns empty array for unknown frameworks', () => {
    const excludes = getFrameworkExcludes(['unknown-framework']);
    expect(excludes).toEqual([]);
  });

  it('returns empty array for empty frameworks list', () => {
    const excludes = getFrameworkExcludes([]);
    expect(excludes).toEqual([]);
  });
});

describe('applyFrameworkProfiles', () => {
  it('adds framework excludes to config', () => {
    const config = makeConfig();
    const result = applyFrameworkProfiles(config, ['nextjs']);

    expect(result.exclude).toContain('**/node_modules/**'); // Original
    expect(result.exclude).toContain('**/.next/**'); // Added
  });

  it('returns original config for empty frameworks', () => {
    const config = makeConfig();
    const result = applyFrameworkProfiles(config, []);

    expect(result).toBe(config);
  });

  it('returns original config for unknown frameworks', () => {
    const config = makeConfig();
    const result = applyFrameworkProfiles(config, ['unknown']);

    expect(result).toBe(config);
  });

  it('deduplicates exclude patterns', () => {
    const config = makeConfig(['**/dist/**']); // Already has dist
    const result = applyFrameworkProfiles(config, ['nestjs']); // NestJS also excludes dist

    // Should not have duplicates
    const distCount = result.exclude!.filter(e => e === '**/dist/**').length;
    expect(distCount).toBe(1);
  });

  it('handles config with no exclude', () => {
    const config: AuditConfig = {
      version: '1.0',
      include: ['**/*.ts'],
      testPatterns: [],
      servicePatterns: [],
    };
    const result = applyFrameworkProfiles(config, ['nextjs']);

    expect(result.exclude).toContain('**/.next/**');
  });

  it('combines multiple framework profiles', () => {
    const config = makeConfig();
    const result = applyFrameworkProfiles(config, ['nextjs', 'prisma', 'sveltekit']);

    expect(result.exclude).toContain('**/.next/**');
    expect(result.exclude).toContain('**/prisma/generated/**');
    expect(result.exclude).toContain('**/.svelte-kit/**');
  });
});
