/**
 * Tests for RLS (Row Level Security) extractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractRLS } from '../src/extractors/rls.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
    ...overrides,
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('RLS Extractor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-rls-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('framework detection', () => {
    it('detects Prisma framework from schema file', async () => {
      createFile(tempDir, 'prisma/schema.prisma', `model User {
  id String @id
  organizationId String
}`);
      createFile(tempDir, 'src/index.ts', 'export {}');

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.framework).toBe('prisma');
    });

    it('detects Supabase framework from imports', async () => {
      createFile(
        tempDir,
        'src/db.ts',
        `
        import { createClient } from '@supabase/supabase-js';
        export const supabase = createClient(url, key);
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.framework).toBe('supabase');
      expect(result.usesSupabase).toBe(true);
    });

    it('detects Drizzle framework from imports', async () => {
      createFile(
        tempDir,
        'src/db.ts',
        `
        import { drizzle } from 'drizzle-orm/pg';
        export const db = drizzle(pool);
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.framework).toBe('drizzle');
    });

    it('detects TypeORM framework from imports', async () => {
      createFile(
        tempDir,
        'src/db.ts',
        `
        import { DataSource } from 'typeorm';
        export const db = new DataSource({});
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.framework).toBe('typeorm');
    });

    it('detects Sequelize framework from imports', async () => {
      createFile(
        tempDir,
        'src/db.ts',
        `
        import { Sequelize } from 'sequelize';
        export const db = new Sequelize();
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.framework).toBe('sequelize');
    });

    it('returns unknown when no framework detected', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.framework).toBe('unknown');
    });
  });

  describe('Prisma multi-tenant extraction', () => {
    it('extracts multi-tenant tables with organizationId', async () => {
      createFile(
        tempDir,
        'prisma/schema.prisma',
        `model Project {
  id String @id
  name String
  organizationId String
  organization Organization @relation(fields: [organizationId], references: [id])
}

model Task {
  id String @id
  title String
  organizationId String
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.multiTenantTables.length).toBeGreaterThanOrEqual(2);
      expect(result.multiTenantTables.some((t) => t.table === 'Project')).toBe(true);
      expect(result.multiTenantTables.some((t) => t.table === 'Task')).toBe(true);
    });

    it('extracts multi-tenant tables with tenantId', async () => {
      createFile(
        tempDir,
        'prisma/schema.prisma',
        `model Invoice {
  id String @id
  tenantId String
  amount Int
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.multiTenantTables.some((t) => t.table === 'Invoice')).toBe(true);
      expect(result.multiTenantTables.find((t) => t.table === 'Invoice')?.tenantPattern).toBe(
        'tenant'
      );
    });

    it('extracts multi-tenant tables with teamId', async () => {
      createFile(
        tempDir,
        'prisma/schema.prisma',
        `model Document {
  id String @id
  teamId String
  content String
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.multiTenantTables.some((t) => t.table === 'Document')).toBe(true);
    });

    it('extracts multi-tenant tables with workspaceId', async () => {
      createFile(
        tempDir,
        'prisma/schema.prisma',
        `model Board {
  id String @id
  workspaceId String
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.multiTenantTables.some((t) => t.table === 'Board')).toBe(true);
    });

    it('extracts multi-tenant tables with userId', async () => {
      createFile(
        tempDir,
        'prisma/schema.prisma',
        `model Note {
  id String @id
  userId String
  content String
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.multiTenantTables.some((t) => t.table === 'Note')).toBe(true);
    });
  });

  describe('SQL RLS policy extraction', () => {
    it('extracts RLS policies from SQL migrations', async () => {
      createFile(
        tempDir,
        'supabase/migrations/001_rls.sql',
        `-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY select_projects ON projects FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY insert_projects ON projects FOR INSERT WITH CHECK (auth.uid() = user_id);`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.rlsPolicies.length).toBeGreaterThanOrEqual(2);
      expect(result.rlsPolicies.some((p) => p.table === 'projects')).toBe(true);
    });

    it('extracts RLS policies with different operations', async () => {
      createFile(
        tempDir,
        'migrations/001.sql',
        `CREATE POLICY select_items ON items FOR SELECT USING (true);
CREATE POLICY update_items ON items FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY delete_items ON items FOR DELETE USING (owner_id = auth.uid());
CREATE POLICY insert_items ON items FOR INSERT WITH CHECK (true);`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const itemPolicies = result.rlsPolicies.filter((p) => p.table === 'items');
      expect(itemPolicies.some((p) => p.operations?.includes('SELECT'))).toBe(true);
      expect(itemPolicies.some((p) => p.operations?.includes('UPDATE'))).toBe(true);
      expect(itemPolicies.some((p) => p.operations?.includes('DELETE'))).toBe(true);
      expect(itemPolicies.some((p) => p.operations?.includes('INSERT'))).toBe(true);
    });

    it('extracts ALL operation policies', async () => {
      createFile(
        tempDir,
        'migrations/001.sql',
        `CREATE POLICY all_access ON documents FOR ALL USING (true);`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.rlsPolicies.some((p) => p.operations?.includes('ALL'))).toBe(true);
    });
  });

  describe('RLS context helper detection', () => {
    it('detects withRLSContext pattern', async () => {
      createFile(
        tempDir,
        'src/db.ts',
        `
        export async function withRLSContext(tenantId: string, fn: () => Promise<void>) {
          await db.$executeRaw\`SET LOCAL app.tenant_id = \${tenantId}\`;
          await fn();
        }
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.hasRLSContextHelper).toBe(true);
    });

    it('detects setTenantContext pattern', async () => {
      createFile(
        tempDir,
        'src/tenant.ts',
        `
        export function setTenantContext(ctx: Context, tenantId: string) {
          ctx.tenantId = tenantId;
        }
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.hasRLSContextHelper).toBe(true);
    });

    it('detects SET LOCAL app. pattern', async () => {
      createFile(
        tempDir,
        'src/db.ts',
        `
        await db.$executeRaw\`SET LOCAL app.tenant_id = \${tenantId}\`;
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.hasRLSContextHelper).toBe(true);
    });

    it('detects current_setting pattern', async () => {
      createFile(
        tempDir,
        'src/db.ts',
        `
        const tenantId = current_setting('app.tenant_id');
      `
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.hasRLSContextHelper).toBe(true);
    });

    it('returns false when no RLS context helper found', async () => {
      createFile(tempDir, 'src/index.ts', 'export const x = 1;');

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.hasRLSContextHelper).toBe(false);
    });
  });

  describe('database query extraction', () => {
    it('extracts Prisma findMany queries', async () => {
      createFile(
        tempDir,
        'prisma/schema.prisma',
        `model Project {
  id String @id
  organizationId String
}`
      );
      createFile(
        tempDir,
        'src/projects.ts',
        `import { prisma } from './db';

export async function getProjects() {
  return prisma.project.findMany();
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.queries.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts Prisma queries with tenant filter', async () => {
      createFile(
        tempDir,
        'prisma/schema.prisma',
        `model Project {
  id String @id
  organizationId String
}`
      );
      createFile(
        tempDir,
        'src/projects.ts',
        `export async function getOrgProjects(organizationId: string) {
  return prisma.project.findMany({
    where: { organizationId }
  });
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      const filteredQuery = result.queries.find(
        (q) => q.table === 'project' && q.hasTenantFilter
      );
      expect(filteredQuery).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty project', async () => {
      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.multiTenantTables).toEqual([]);
      expect(result.rlsPolicies).toEqual([]);
      expect(result.queries).toEqual([]);
    });

    it('skips node_modules', async () => {
      createFile(
        tempDir,
        'node_modules/@supabase/supabase-js/index.ts',
        `
        export const createClient = () => {};
      `
      );
      createFile(tempDir, 'src/index.ts', 'export {}');

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      // Should not detect Supabase from node_modules
      expect(result.usesSupabase).toBe(false);
    });

    it('finds Prisma schema in alternative locations', async () => {
      createFile(
        tempDir,
        'packages/db/prisma/schema.prisma',
        `model User {
  id String @id
  organizationId String
}`
      );

      const result = await extractRLS({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.framework).toBe('prisma');
      expect(result.multiTenantTables.some((t) => t.table === 'User')).toBe(true);
    });
  });
});
