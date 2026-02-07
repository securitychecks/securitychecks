/**
 * Tests for services extractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractServices } from '../src/extractors/services.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/services/**/*.ts', '**/*.service.ts'],
    authzFunctions: ['authorize'],
    ...overrides,
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('extractServices', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-services-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('empty project', () => {
    it('returns empty array when no files', async () => {
      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('basic service detection', () => {
    it('detects exported function declarations', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export function getUser(id: string) {
  return db.user.findUnique({ where: { id } });
}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.exportedFunctions).toContain('getUser');
    });

    it('detects exported arrow functions', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export const createUser = (data: UserInput) => {
  return db.user.create({ data });
};`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.exportedFunctions).toContain('createUser');
    });

    it('detects exported function expressions', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export const updateUser = function(id: string, data: any) {
  return db.user.update({ where: { id }, data });
};`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.exportedFunctions).toContain('updateUser');
    });

    it('detects wrapped function exports (createService)', async () => {
      createFile(
        tempDir,
        'services/billing.ts',
        `export const billingService = createService(() => ({
  charge: async (amount: number) => { },
}));`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.exportedFunctions).toContain('billingService');
    });

    it('captures multiple exported functions', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export function getUser(id: string) {
  return db.user.findUnique({ where: { id } });
}

export function updateUser(id: string, data: any) {
  return db.user.update({ where: { id }, data });
}

export const deleteUser = async (id: string) => {
  return db.user.delete({ where: { id } });
};`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.exportedFunctions.length).toBe(3);
      expect(result[0]?.exportedFunctions).toContain('getUser');
      expect(result[0]?.exportedFunctions).toContain('updateUser');
      expect(result[0]?.exportedFunctions).toContain('deleteUser');
    });

    it('captures file and line information', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.file).toContain('services/user.ts');
      expect(result[0]?.line).toBe(1);
    });
  });

  describe('service name extraction', () => {
    it('extracts name from services directory', async () => {
      createFile(
        tempDir,
        'services/membership.ts',
        `export function getMembership() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('membership');
    });

    it('extracts name from nested path', async () => {
      createFile(
        tempDir,
        'services/billing/subscription.ts',
        `export function getSubscription() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result[0]?.name).toBe('billing/subscription');
    });

    it('uses directory name for index files', async () => {
      createFile(
        tempDir,
        'services/payment/index.ts',
        `export function processPayment() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result[0]?.name).toBe('payment');
    });

    it('skips lib prefix in path', async () => {
      createFile(
        tempDir,
        'lib/services/user.service.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/*.service.ts'],
        }),
      });

      expect(result[0]?.name).toBe('user.service');
    });

    it('skips server prefix in path', async () => {
      createFile(
        tempDir,
        'server/services/auth.ts',
        `export function authenticate() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result[0]?.name).toBe('auth');
    });
  });

  describe('frontend file exclusions', () => {
    it('excludes admin-x-* paths', async () => {
      createFile(
        tempDir,
        'src/admin-x-settings/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes design-system paths', async () => {
      createFile(
        tempDir,
        'src/design-system/services/theme.ts',
        `export function getTheme() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes components paths', async () => {
      createFile(
        tempDir,
        'src/components/services/data.ts',
        `export function fetchData() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes ui paths', async () => {
      createFile(
        tempDir,
        'src/ui/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes hooks paths', async () => {
      createFile(
        tempDir,
        'src/hooks/services/user.ts',
        `export function useUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes stores paths', async () => {
      createFile(
        tempDir,
        'src/stores/services/user.ts',
        `export function getUserStore() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes .client.ts files', async () => {
      createFile(
        tempDir,
        'services/user.client.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes client paths', async () => {
      createFile(
        tempDir,
        'src/client/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes frontend paths', async () => {
      createFile(
        tempDir,
        'src/frontend/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes utils/api paths', async () => {
      createFile(
        tempDir,
        'src/utils/api/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes .schema.ts files', async () => {
      createFile(
        tempDir,
        'services/user.schema.ts',
        `export function getUserSchema() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes Schema.ts files', async () => {
      createFile(
        tempDir,
        'services/UserSchema.ts',
        `export function getUserSchema() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes schemas paths', async () => {
      createFile(
        tempDir,
        'src/schemas/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes .types.ts files', async () => {
      createFile(
        tempDir,
        'services/user.types.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes types paths', async () => {
      createFile(
        tempDir,
        'src/types/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes .dto.ts files', async () => {
      createFile(
        tempDir,
        'services/user.dto.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes dtos paths', async () => {
      createFile(
        tempDir,
        'src/dtos/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes models paths', async () => {
      createFile(
        tempDir,
        'src/models/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes .model.ts files', async () => {
      createFile(
        tempDir,
        'services/user.model.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes repositories paths', async () => {
      createFile(
        tempDir,
        'src/repositories/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes .repository.ts files', async () => {
      createFile(
        tempDir,
        'services/user.repository.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes .entity.ts files', async () => {
      createFile(
        tempDir,
        'services/user.entity.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes entities paths', async () => {
      createFile(
        tempDir,
        'src/entities/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });

    it('excludes dao paths', async () => {
      createFile(
        tempDir,
        'src/dao/services/user.ts',
        `export function getUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig({
          servicePatterns: ['**/services/**/*.ts'],
        }),
      });

      expect(result.length).toBe(0);
    });
  });

  describe('React pattern exclusions', () => {
    it('excludes files with React import', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `import React from 'react';
export function UserComponent() { return null; }`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes files with React Query import', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `import { useQuery } from '@tanstack/react-query';
export function useUser() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes files with React hook exports', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export const useUser = () => {
  return { user: null };
};`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes files with createMutation usage', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export const updateUser = createMutation<User>({
  mutationFn: async (data) => api.updateUser(data),
});`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });

    it('excludes files with createQuery usage', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export const fetchUser = createQuery<User>({
  queryFn: async () => api.getUser(),
});`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });
  });

  describe('multiple files', () => {
    it('extracts services from multiple files', async () => {
      createFile(
        tempDir,
        'services/user.ts',
        `export function getUser() {}`
      );
      createFile(
        tempDir,
        'services/billing.ts',
        `export function getBilling() {}`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(2);
      expect(result.some((s) => s.name === 'user')).toBe(true);
      expect(result.some((s) => s.name === 'billing')).toBe(true);
    });
  });

  describe('files without exported functions', () => {
    it('does not include files with only non-callable exports', async () => {
      createFile(
        tempDir,
        'services/config.ts',
        `export const CONFIG = { apiUrl: 'http://localhost' };
export type User = { id: string };`
      );

      const result = await extractServices({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(0);
    });
  });
});
