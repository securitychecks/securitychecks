import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDataFlows } from '../src/extractors/dataflow.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides?: Partial<AuditConfig>): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
    ...overrides,
  };
}

describe('extractDataFlows', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sc-dataflow-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('source detection', () => {
    it('detects request body sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(req: { body: unknown }) {
  const input = req.body;
  return input;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'request_body')).toBe(true);
    });

    it('detects request query sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(req: { query: unknown }) {
  const filter = req.query;
  return filter;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'request_query')).toBe(true);
    });

    it('detects request params sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(req: { params: { id: string } }) {
  const id = req.params.id;
  return id;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'request_params')).toBe(true);
    });

    it('detects request headers sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(req: { headers: unknown }) {
  const auth = req.headers;
  return auth;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'request_headers')).toBe(true);
    });

    it('detects request cookies sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(req: { cookies: unknown }) {
  const session = req.cookies;
  return session;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'request_cookies')).toBe(true);
    });

    it('detects form data sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export async function handler(formData: FormData) {
  const name = formData.get('name');
  return name;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'form_data')).toBe(true);
    });

    it('detects Next.js URL params sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler({ params }: { params: { id: string } }) {
  return params.id;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'url_param')).toBe(true);
    });

    it('detects searchParams sources', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(searchParams: URLSearchParams) {
  const q = searchParams.get('q');
  return q;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.type === 'request_query')).toBe(true);
    });

    it('deduplicates sources with same file, line, and type', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(req: { body: unknown }) {
  const a = req.body;
  const b = req.body;
  return { a, b };
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      const bodySourceLines = graph.sources
        .filter((s) => s.type === 'request_body')
        .map((s) => s.line);
      const uniqueLines = new Set(bodySourceLines);
      expect(uniqueLines.size).toBe(bodySourceLines.length);
    });
  });

  describe('sink detection', () => {
    it('detects Prisma findMany sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `const prisma = { user: { findMany: async (_: unknown) => [] } };
export async function handler() {
  await prisma.user.findMany({ where: {} });
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'database_query')).toBe(true);
    });

    it('detects Prisma raw query sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `const prisma = { $queryRaw: async (q: string) => [] };
export async function handler(query: string) {
  await prisma.$queryRaw(query);
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'sql_query')).toBe(true);
    });

    it('detects file read sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `import fs from 'fs';
export async function handler(path: string) {
  const data = await fs.readFile(path);
  return data;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'file_read')).toBe(true);
    });

    it('detects file write sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `import fs from 'fs';
export async function handler(path: string, data: string) {
  await fs.writeFile(path, data);
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'file_write')).toBe(true);
    });

    it('detects command execution sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `import child_process from 'child_process';
export function handler(cmd: string) {
  child_process.exec(cmd);
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'command_exec')).toBe(true);
    });

    it('detects eval sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(code: string) {
  eval(code);
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'eval')).toBe(true);
    });

    it('detects redirect sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(url: string, res: { redirect: (u: string) => void }) {
  res.redirect(url);
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'redirect')).toBe(true);
    });

    it('detects res.send sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(req: { body: string }, res: { send: (data: string) => void }) {
  res.send(req.body);
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'html_response')).toBe(true);
    });
  });

  describe('transform detection', () => {
    it('detects validation transforms', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `const schema = { parse: (x: unknown) => x };
export function handler(input: unknown) {
  const validated = schema.parse(input);
  return validated;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.transforms.some((t) => t.type === 'validate')).toBe(true);
    });

    it('detects sanitization transforms', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `function sanitize(x: string): string { return x; }
export function handler(input: string) {
  const clean = sanitize(input);
  return clean;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.transforms.some((t) => t.type === 'sanitize')).toBe(true);
    });

    it('detects encoding transforms', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(input: string) {
  const encoded = encodeURIComponent(input);
  return encoded;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.transforms.some((t) => t.type === 'encode')).toBe(true);
    });

    it('detects parsing transforms', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(input: string) {
  const parsed = JSON.parse(input);
  return parsed;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.transforms.some((t) => t.type === 'parse')).toBe(true);
    });

    it('detects slice transforms', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(input: string) {
  const limited = input.slice(0, 100);
  return limited;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.transforms.some((t) => t.type === 'slice')).toBe(true);
    });

    it('detects filter transforms', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export function handler(items: string[]) {
  const filtered = items.filter((x) => x.length > 0);
  return filtered;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.transforms.some((t) => t.type === 'filter')).toBe(true);
    });
  });

  describe('flow connection', () => {
    it('connects request body sources to prisma sinks and marks validation', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
const schema = { parse: (x: unknown) => x };
const prisma = { user: { findMany: async (_q: unknown) => [] as unknown[] } };

export async function handler(req: { body: unknown }) {
  const input = req.body;
  const validated = schema.parse(input);
  await prisma.user.findMany({ where: input });
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.length).toBeGreaterThan(0);
      expect(graph.sinks.length).toBeGreaterThan(0);
      expect(graph.transforms.length).toBeGreaterThan(0);
      expect(graph.flows.length).toBeGreaterThan(0);

      const flow = graph.flows.find((f) => f.source.variable === 'input');
      expect(flow).toBeTruthy();
      expect(flow?.sink.type).toBe('database_query');
      expect(flow?.isValidated).toBe(true);
    });

    it('marks flows as sanitized when sanitization transform is present', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
const prisma = { user: { create: async (_: unknown) => {} } };
function sanitize(x: string): string { return x.replace(/<[^>]*>/g, ''); }
export async function handler(req: { body: { name: string } }) {
  const input = req.body.name;
  const clean = sanitize(input);
  await prisma.user.create({ data: { name: input } });
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      // The flow exists and has a sanitize transform between source and sink
      const flow = graph.flows.find((f) => f.source.variable === 'input');
      expect(flow).toBeTruthy();
      expect(flow?.isSanitized).toBe(true);
    });

    it('does not connect sources and sinks in different functions', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
const prisma = { user: { findMany: async (_: unknown) => [] } };

export function getInput(req: { body: unknown }) {
  const input = req.body;
  return input;
}

export async function query() {
  await prisma.user.findMany({ where: {} });
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.length).toBeGreaterThan(0);
      expect(graph.sinks.length).toBeGreaterThan(0);
      expect(graph.flows.length).toBe(0);
    });
  });

  describe('destructured variable flow connection', () => {
    it('connects destructured req.query to $queryRawUnsafe sink', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
const db = { $queryRawUnsafe: async (q: string) => [] };
export async function handler(req: { query: { name: string } }) {
  const { name } = req.query;
  await db.$queryRawUnsafe('SELECT * FROM users WHERE name = ' + name);
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.length).toBeGreaterThan(0);
      expect(graph.sinks.some((s) => s.type === 'sql_query')).toBe(true);
      expect(graph.flows.length).toBeGreaterThan(0);
      const flow = graph.flows.find((f) => f.sink.type === 'sql_query');
      expect(flow).toBeTruthy();
    });

    it('connects destructured req.body to res.send sink', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
export function handler(req: { body: { html: string } }, res: { send: (d: string) => void }) {
  const { html } = req.body;
  res.send(html);
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.flows.length).toBeGreaterThan(0);
      const flow = graph.flows.find((f) => f.sink.type === 'html_response');
      expect(flow).toBeTruthy();
    });

    it('does not connect sanitized destructured flow', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
function sanitize(x: string): string { return x.replace(/<[^>]*>/g, ''); }
export function handler(req: { body: { html: string } }, res: { send: (d: string) => void }) {
  const { html } = req.body;
  const clean = sanitize(html);
  res.send(clean);
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      // Flow should exist but be marked as sanitized
      const flow = graph.flows.find((f) => f.sink.type === 'html_response');
      if (flow) {
        expect(flow.isSanitized).toBe(true);
      }
    });

    it('does not connect destructured vars across different functions', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
const db = { $queryRawUnsafe: async (q: string) => [] };
export function parseInput(req: { query: { name: string } }) {
  const { name } = req.query;
  return name;
}
export async function runQuery(q: string) {
  await db.$queryRawUnsafe(q);
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.length).toBeGreaterThan(0);
      expect(graph.sinks.length).toBeGreaterThan(0);
      expect(graph.flows.length).toBe(0);
    });

    it('connects via access path matching', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
export function handler(req: { query: { search: string } }, res: { send: (d: string) => void }) {
  const q = req.query.search;
  res.send(q);
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.flows.length).toBeGreaterThan(0);
    });
  });

  describe('admin context detection', () => {
    it('marks flows in admin directory as admin protected', async () => {
      mkdirSync(join(tempDir, 'src/admin'), { recursive: true });
      writeFileSync(
        join(tempDir, 'src/admin/handler.ts'),
        `
const prisma = { user: { findMany: async (_: unknown) => [] } };
export async function handler(req: { body: unknown }) {
  const input = req.body;
  await prisma.user.findMany({ where: input });
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      const flow = graph.flows[0];
      expect(flow?.isAdminProtected).toBe(true);
    });

    it('marks flows with admin function names as admin protected', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
const prisma = { user: { findMany: async (_: unknown) => [] } };
export async function adminGetUsers(req: { body: unknown }) {
  const input = req.body;
  await prisma.user.findMany({ where: input });
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      const flow = graph.flows[0];
      expect(flow?.isAdminProtected).toBe(true);
    });

    it('does not mark regular flows as admin protected', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `
const prisma = { user: { findMany: async (_: unknown) => [] } };
export async function getUsers(req: { body: unknown }) {
  const input = req.body;
  await prisma.user.findMany({ where: input });
}
        `.trim()
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      const flow = graph.flows[0];
      expect(flow?.isAdminProtected).toBe(false);
    });
  });

  describe('config options', () => {
    it('respects maxFileBytes option', async () => {
      const largeContent = 'x'.repeat(10000);
      writeFileSync(
        join(tempDir, 'src/large.ts'),
        `
// ${largeContent}
export function handler(req: { body: unknown }) {
  const input = req.body;
  return input;
}
        `.trim()
      );

      const config = makeConfig({
        dataflow: { maxFileBytes: 1000 },
      });
      const graph = await extractDataFlows({ targetPath: tempDir, config });
      // Large file should be skipped
      expect(graph.sources.length).toBe(0);
    });

    it('respects maxFileLines option', async () => {
      const manyLines = Array.from({ length: 1000 }, (_, i) => `// line ${i}`).join('\n');
      writeFileSync(
        join(tempDir, 'src/manylines.ts'),
        `
${manyLines}
export function handler(req: { body: unknown }) {
  const input = req.body;
  return input;
}
        `.trim()
      );

      const config = makeConfig({
        dataflow: { maxFileLines: 100 },
      });
      const graph = await extractDataFlows({ targetPath: tempDir, config });
      // File with too many lines should be skipped
      expect(graph.sources.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty graph for empty directory', async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'sc-dataflow-empty-'));
      try {
        const graph = await extractDataFlows({ targetPath: emptyDir, config: makeConfig() });
        expect(graph.sources).toHaveLength(0);
        expect(graph.sinks).toHaveLength(0);
        expect(graph.transforms).toHaveLength(0);
        expect(graph.flows).toHaveLength(0);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('handles files without sources or sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/utils.ts'),
        `export function add(a: number, b: number): number {
  return a + b;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources).toHaveLength(0);
      expect(graph.sinks).toHaveLength(0);
    });

    it('handles arrow function context', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `const prisma = { user: { findMany: async (_: unknown) => [] } };
export const handler = async (req: { body: unknown }) => {
  const input = req.body;
  await prisma.user.findMany({ where: input });
};`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.functionContext === 'handler')).toBe(true);
      expect(graph.sinks.some((s) => s.functionContext === 'handler')).toBe(true);
    });

    it('handles method declarations', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `const prisma = { user: { findMany: async (_: unknown) => [] } };
class UserService {
  async getUsers(req: { body: unknown }) {
    const input = req.body;
    await prisma.user.findMany({ where: input });
  }
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sources.some((s) => s.functionContext === 'getUsers')).toBe(true);
    });

    it('builds flow path correctly', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `const prisma = { user: { findMany: async (_: unknown) => [] } };
export async function handler(req: { body: unknown }) {
  const input = req.body;
  await prisma.user.findMany({ where: input });
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      const flow = graph.flows.find((f) => f.source.variable === 'input');
      expect(flow).toBeTruthy();
      expect(flow?.flowPath).toBeDefined();
      expect(flow?.flowPath.length).toBeGreaterThan(0);
    });
  });

  describe('MongoDB sinks', () => {
    it('detects MongoDB find sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export async function handler(db: { collection: (n: string) => { find: (q: unknown) => unknown } }) {
  const users = db.collection('users');
  const result = users.find({ name: 'test' });
  return result;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'nosql_query')).toBe(true);
    });

    it('detects MongoDB aggregate sinks', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export async function handler(collection: { aggregate: (p: unknown[]) => unknown }) {
  const result = collection.aggregate([{ $match: {} }]);
  return result;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'nosql_query')).toBe(true);
    });
  });

  describe('SQL query sinks', () => {
    it('detects Knex raw queries', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export async function handler(knex: { raw: (q: string) => unknown }) {
  const result = knex.raw('SELECT * FROM users');
  return result;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'sql_query')).toBe(true);
    });

    it('detects direct SQL query strings', async () => {
      writeFileSync(
        join(tempDir, 'src/handler.ts'),
        `export async function handler(db: { query: (q: string) => unknown }) {
  const result = db.query('SELECT * FROM users WHERE id = 1');
  return result;
}`
      );

      const graph = await extractDataFlows({ targetPath: tempDir, config: makeConfig() });
      expect(graph.sinks.some((s) => s.type === 'sql_query')).toBe(true);
    });
  });
});
