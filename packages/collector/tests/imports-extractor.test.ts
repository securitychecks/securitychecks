/**
 * Tests for imports extractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Project } from 'ts-morph';
import {
  extractImports,
  extractExports,
  resolveCall,
  buildImportGraph,
  type FileImports,
} from '../src/extractors/imports.js';

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('imports extractor', () => {
  let tempDir: string;
  let project: Project;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-imports-'));
    project = new Project({
      compilerOptions: {
        target: 99, // ESNext
        module: 99, // ESNext
      },
      useInMemoryFileSystem: false,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('extractImports', () => {
    describe('ES6 named imports', () => {
      it('extracts simple named import', () => {
        createFile(
          tempDir,
          'src/utils.ts',
          `export function helper() {}`
        );
        createFile(
          tempDir,
          'src/service.ts',
          `import { helper } from './utils';
export function run() { helper(); }`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports.length).toBe(1);
        expect(result.imports[0]?.localName).toBe('helper');
        expect(result.imports[0]?.originalName).toBe('helper');
        expect(result.imports[0]?.type).toBe('named');
      });

      it('extracts aliased named import', () => {
        createFile(
          tempDir,
          'src/email.ts',
          `export function sendEmail() {}`
        );
        createFile(
          tempDir,
          'src/service.ts',
          `import { sendEmail as notify } from './email';
export function run() { notify(); }`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.localName).toBe('notify');
        expect(result.imports[0]?.originalName).toBe('sendEmail');
      });

      it('extracts multiple named imports', () => {
        createFile(
          tempDir,
          'src/utils.ts',
          `export function foo() {}
export function bar() {}`
        );
        createFile(
          tempDir,
          'src/service.ts',
          `import { foo, bar } from './utils';`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports.length).toBe(2);
        expect(result.byLocalName.has('foo')).toBe(true);
        expect(result.byLocalName.has('bar')).toBe(true);
      });

      it('populates byOriginalName lookup', () => {
        createFile(
          tempDir,
          'src/utils.ts',
          `export function helper() {}`
        );
        createFile(
          tempDir,
          'src/service.ts',
          `import { helper } from './utils';`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.byOriginalName.has('helper')).toBe(true);
        expect(result.byOriginalName.get('helper')?.length).toBe(1);
      });
    });

    describe('ES6 default imports', () => {
      it('extracts default import', () => {
        createFile(
          tempDir,
          'src/config.ts',
          `export default { api: 'url' };`
        );
        createFile(
          tempDir,
          'src/service.ts',
          `import config from './config';`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.localName).toBe('config');
        expect(result.imports[0]?.originalName).toBe('default');
        expect(result.imports[0]?.type).toBe('default');
      });

      it('populates byOriginalName for default import', () => {
        createFile(
          tempDir,
          'src/config.ts',
          `export default {};`
        );
        createFile(
          tempDir,
          'src/service.ts',
          `import config from './config';`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.byOriginalName.has('default')).toBe(true);
      });
    });

    describe('ES6 namespace imports', () => {
      it('extracts namespace import', () => {
        createFile(
          tempDir,
          'src/utils.ts',
          `export function foo() {}
export function bar() {}`
        );
        createFile(
          tempDir,
          'src/service.ts',
          `import * as utils from './utils';`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.localName).toBe('utils');
        expect(result.imports[0]?.originalName).toBe('*');
        expect(result.imports[0]?.type).toBe('namespace');
      });
    });

    describe('CommonJS requires', () => {
      it('extracts simple require', () => {
        createFile(
          tempDir,
          'src/service.ts',
          `const config = require('./config');`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.localName).toBe('config');
        expect(result.imports[0]?.originalName).toBe('default');
        expect(result.imports[0]?.type).toBe('commonjs');
      });

      it('extracts destructured require', () => {
        createFile(
          tempDir,
          'src/service.ts',
          `const { foo, bar } = require('./utils');`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports.length).toBe(2);
        expect(result.imports.some((i) => i.localName === 'foo')).toBe(true);
        expect(result.imports.some((i) => i.localName === 'bar')).toBe(true);
      });

      it('extracts aliased destructured require', () => {
        createFile(
          tempDir,
          'src/service.ts',
          `const { sendEmail: notify } = require('./email');`
        );

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.localName).toBe('notify');
        expect(result.imports[0]?.originalName).toBe('sendEmail');
      });
    });

    describe('module path resolution', () => {
      it('resolves relative .ts files', () => {
        createFile(tempDir, 'src/utils.ts', `export function helper() {}`);
        createFile(tempDir, 'src/service.ts', `import { helper } from './utils';`);

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.resolvedPath).toContain('utils.ts');
      });

      it('resolves index.ts files', () => {
        createFile(tempDir, 'src/lib/index.ts', `export function helper() {}`);
        createFile(tempDir, 'src/service.ts', `import { helper } from './lib';`);

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.resolvedPath).toContain('index.ts');
      });

      it('returns undefined for node_modules imports', () => {
        createFile(tempDir, 'src/service.ts', `import express from 'express';`);

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.resolvedPath).toBeUndefined();
      });

      it('handles unresolvable paths', () => {
        createFile(tempDir, 'src/service.ts', `import { foo } from './nonexistent';`);

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.imports[0]?.resolvedPath).toBeDefined();
      });
    });

    describe('file metadata', () => {
      it('returns relative file path', () => {
        createFile(tempDir, 'src/deep/nested/service.ts', `import { x } from './utils';`);

        const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/deep/nested/service.ts'));
        const result = extractImports(sourceFile, tempDir);

        expect(result.file).toBe('src/deep/nested/service.ts');
      });
    });
  });

  describe('extractExports', () => {
    it('extracts named function exports', () => {
      createFile(
        tempDir,
        'src/utils.ts',
        `export function helper() {}
export function another() {}`
      );

      const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/utils.ts'));
      const result = extractExports(sourceFile, tempDir);

      expect(result.length).toBe(2);
      expect(result.some((e) => e.name === 'helper')).toBe(true);
      expect(result.some((e) => e.name === 'another')).toBe(true);
    });

    it('extracts named const exports', () => {
      createFile(
        tempDir,
        'src/config.ts',
        `export const API_URL = 'http://localhost';
export const TIMEOUT = 5000;`
      );

      const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/config.ts'));
      const result = extractExports(sourceFile, tempDir);

      expect(result.some((e) => e.name === 'API_URL')).toBe(true);
      expect(result.some((e) => e.name === 'TIMEOUT')).toBe(true);
    });

    it('extracts default export', () => {
      createFile(
        tempDir,
        'src/config.ts',
        `const config = { api: 'url' };
export default config;`
      );

      const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/config.ts'));
      const result = extractExports(sourceFile, tempDir);

      expect(result.some((e) => e.name === 'default')).toBe(true);
    });

    it('includes file path in exports', () => {
      createFile(tempDir, 'src/utils.ts', `export function helper() {}`);

      const sourceFile = project.addSourceFileAtPath(join(tempDir, 'src/utils.ts'));
      const result = extractExports(sourceFile, tempDir);

      expect(result[0]?.file).toBe('src/utils.ts');
    });
  });

  describe('resolveCall', () => {
    let fileImports: FileImports;

    beforeEach(() => {
      fileImports = {
        file: 'test.ts',
        imports: [],
        byLocalName: new Map(),
        byOriginalName: new Map(),
      };
    });

    it('returns null for local function', () => {
      const result = resolveCall('localFn', undefined, fileImports);
      expect(result).toBeNull();
    });

    it('resolves named import', () => {
      fileImports.byLocalName.set('helper', {
        localName: 'helper',
        originalName: 'helper',
        sourceModule: './utils',
        resolvedPath: 'utils.ts',
        type: 'named',
      });

      const result = resolveCall('helper', undefined, fileImports);

      expect(result?.originalName).toBe('helper');
      expect(result?.sourceFile).toBe('utils.ts');
    });

    it('resolves aliased named import', () => {
      fileImports.byLocalName.set('notify', {
        localName: 'notify',
        originalName: 'sendEmail',
        sourceModule: './email',
        resolvedPath: 'email.ts',
        type: 'named',
      });

      const result = resolveCall('notify', undefined, fileImports);

      expect(result?.originalName).toBe('sendEmail');
    });

    it('resolves namespace import with property access', () => {
      fileImports.byLocalName.set('utils', {
        localName: 'utils',
        originalName: '*',
        sourceModule: './utils',
        resolvedPath: 'utils.ts',
        type: 'namespace',
      });

      const result = resolveCall('utils', 'helper', fileImports);

      expect(result?.originalName).toBe('helper');
      expect(result?.sourceFile).toBe('utils.ts');
    });

    it('resolves default import', () => {
      fileImports.byLocalName.set('config', {
        localName: 'config',
        originalName: 'default',
        sourceModule: './config',
        resolvedPath: 'config.ts',
        type: 'default',
      });

      const result = resolveCall('config', undefined, fileImports);

      expect(result?.originalName).toBe('config');
    });

    it('resolves default import with property access', () => {
      fileImports.byLocalName.set('service', {
        localName: 'service',
        originalName: 'default',
        sourceModule: './service',
        resolvedPath: 'service.ts',
        type: 'default',
      });

      const result = resolveCall('service', 'method', fileImports);

      expect(result?.originalName).toBe('method');
    });

    it('resolves commonjs import with property access', () => {
      fileImports.byLocalName.set('lib', {
        localName: 'lib',
        originalName: 'default',
        sourceModule: './lib',
        resolvedPath: 'lib.ts',
        type: 'commonjs',
      });

      const result = resolveCall('lib', 'foo', fileImports);

      expect(result?.originalName).toBe('foo');
    });

    it('returns null for named import with property access', () => {
      fileImports.byLocalName.set('helper', {
        localName: 'helper',
        originalName: 'helper',
        sourceModule: './utils',
        resolvedPath: 'utils.ts',
        type: 'named',
      });

      const result = resolveCall('helper', 'method', fileImports);

      expect(result).toBeNull();
    });
  });

  describe('buildImportGraph', () => {
    it('builds graph from multiple files', () => {
      createFile(tempDir, 'src/utils.ts', `export function helper() {}`);
      createFile(tempDir, 'src/service.ts', `import { helper } from './utils';`);

      const sourceFiles = [
        project.addSourceFileAtPath(join(tempDir, 'src/utils.ts')),
        project.addSourceFileAtPath(join(tempDir, 'src/service.ts')),
      ];

      const graph = buildImportGraph(sourceFiles, tempDir);

      expect(graph.files.size).toBe(2);
      expect(graph.exports.has('helper')).toBe(true);
    });

    it('tracks exports with their source files', () => {
      createFile(tempDir, 'src/a.ts', `export function foo() {}`);
      createFile(tempDir, 'src/b.ts', `export function foo() {}`);

      const sourceFiles = [
        project.addSourceFileAtPath(join(tempDir, 'src/a.ts')),
        project.addSourceFileAtPath(join(tempDir, 'src/b.ts')),
      ];

      const graph = buildImportGraph(sourceFiles, tempDir);

      expect(graph.exports.get('foo')?.length).toBe(2);
    });

    it('handles files with no imports', () => {
      createFile(tempDir, 'src/standalone.ts', `export const x = 1;`);

      const sourceFiles = [
        project.addSourceFileAtPath(join(tempDir, 'src/standalone.ts')),
      ];

      const graph = buildImportGraph(sourceFiles, tempDir);

      expect(graph.files.get('src/standalone.ts')?.imports.length).toBe(0);
    });

    it('handles files with no exports', () => {
      createFile(tempDir, 'src/internal.ts', `const x = 1;`);

      const sourceFiles = [
        project.addSourceFileAtPath(join(tempDir, 'src/internal.ts')),
      ];

      const graph = buildImportGraph(sourceFiles, tempDir);

      expect(graph.files.size).toBe(1);
    });
  });
});
