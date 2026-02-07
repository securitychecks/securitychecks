import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractJobs } from '../src/extractors/jobs.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('extractJobs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-jobs-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('empty project', () => {
    it('returns empty array when no files', async () => {
      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('trigger.dev', () => {
    it('detects schemaTask with id', async () => {
      createFile(
        tempDir,
        'src/tasks/email.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const sendEmail = schemaTask({
  id: 'send-email',
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('send-email');
      expect(result[0]?.framework).toBe('trigger');
    });

    it('detects task with name property', async () => {
      createFile(
        tempDir,
        'src/tasks/notify.ts',
        `import { task } from '@trigger.dev/sdk';
export const notify = task({
  name: 'send-notification',
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('send-notification');
    });

    it('uses variable name when no id/name property', async () => {
      createFile(
        tempDir,
        'src/tasks/sync.ts',
        `import { task } from '@trigger.dev/sdk';
export const syncUsers = task({
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('syncUsers');
    });

    it('detects idempotency patterns', async () => {
      createFile(
        tempDir,
        'src/tasks/process.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const processOrder = schemaTask({
  id: 'process-order',
  run: async ({ orderId }) => {
    const alreadyProcessed = await db.order.findUnique({ where: { id: orderId } });
    if (alreadyProcessed) return;
    await db.order.create({ data: { id: orderId } });
  },
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('detects dedup pattern', async () => {
      createFile(
        tempDir,
        'src/tasks/dedup.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const dedupTask = schemaTask({
  id: 'dedup-task',
  run: async () => {
    await deduplicateJob(jobId);
  },
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });
  });

  describe('bullmq', () => {
    it('detects Worker with queue name', async () => {
      createFile(
        tempDir,
        'src/workers/email.ts',
        `import { Worker } from 'bullmq';
new Worker('email-queue', async (job) => {
  await sendEmail(job.data);
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('email-queue');
      expect(result[0]?.framework).toBe('bullmq');
    });

    it('detects idempotency via upsert', async () => {
      createFile(
        tempDir,
        'src/workers/sync.ts',
        `import { Worker } from 'bullmq';
new Worker('sync-queue', async (job) => {
  await db.record.upsert({ where: { id: job.id }, create: job.data, update: job.data });
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });
  });

  describe('NestJS BullMQ', () => {
    it('detects @Processor and @Process decorators', async () => {
      createFile(
        tempDir,
        'src/queues/billing.processor.ts',
        `import { Processor, Process } from '@nestjs/bull';
@Processor('billing')
export class BillingProcessor {
  @Process('charge')
  async handleCharge(job) {
    await this.billingService.charge(job.data);
  }

  @Process('refund')
  async handleRefund(job) {
    await this.billingService.refund(job.data);
  }
}`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(2);
      expect(result.some((j) => j.name === 'billing:charge')).toBe(true);
      expect(result.some((j) => j.name === 'billing:refund')).toBe(true);
    });

    it('uses method name when no @Process argument', async () => {
      createFile(
        tempDir,
        'src/queues/notifications.processor.ts',
        `import { Processor, Process } from '@nestjs/bull';
@Processor('notifications')
export class NotificationsProcessor {
  @Process()
  async handleNotification(job) {
    await this.notificationService.send(job.data);
  }
}`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('notifications:handleNotification');
    });

    it('detects idempotency in processor methods', async () => {
      createFile(
        tempDir,
        'src/queues/orders.processor.ts',
        `import { Processor, Process } from '@nestjs/bull';
@Processor('orders')
export class OrdersProcessor {
  @Process('fulfill')
  async handleFulfill(job) {
    const processed = await this.db.processedJobs.findUnique({ where: { jobId: job.id } });
    if (processed) return;
    await this.orderService.fulfill(job.data);
    await this.db.processedJobs.create({ data: { jobId: job.id } });
  }
}`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });
  });

  describe('inngest', () => {
    it('detects createFunction with id', async () => {
      createFile(
        tempDir,
        'src/inngest/sync.ts',
        `import { inngest } from './client';
export const syncUsers = inngest.createFunction(
  { id: 'sync-users' },
  { event: 'users/sync' },
  async () => true
);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('sync-users');
      expect(result[0]?.framework).toBe('inngest');
    });

    it('detects createFunction with name property', async () => {
      createFile(
        tempDir,
        'src/inngest/process.ts',
        `import { inngest } from 'inngest';
export const fn = createFunction(
  { name: 'process-webhooks' },
  { event: 'webhook/received' },
  async () => true
);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('process-webhooks');
    });
  });

  describe('custom frameworks', () => {
    it('detects defineJob pattern', async () => {
      createFile(
        tempDir,
        'src/jobs/custom.ts',
        `import { defineJob } from './job-framework';
defineJob({
  name: 'custom-job',
  handler: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      // Custom patterns now extract handlers
      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('defineJob');
      expect(result[0]?.framework).toBe('custom');
    });
  });

  describe('file exclusions', () => {
    it('excludes test files in job directories', async () => {
      createFile(
        tempDir,
        'src/tasks/email.test.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const testTask = schemaTask({
  id: 'test-task',
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes spec files', async () => {
      createFile(
        tempDir,
        'src/tasks/email.spec.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const specTask = schemaTask({ id: 'spec-task', run: async () => true });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes e2e-spec files', async () => {
      createFile(
        tempDir,
        'src/tasks/email.e2e-spec.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const e2eTask = schemaTask({ id: 'e2e-task', run: async () => true });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes __tests__ directory', async () => {
      createFile(
        tempDir,
        'src/__tests__/tasks/email.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const testDirTask = schemaTask({ id: 'test-dir-task', run: async () => true });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes type definition files', async () => {
      createFile(
        tempDir,
        'src/tasks/email.d.ts',
        `export declare const emailTask: any;`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes mock directories', async () => {
      createFile(
        tempDir,
        'src/mocks/tasks.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const mockTask = schemaTask({ id: 'mock-task', run: async () => true });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('file detection', () => {
    it('detects jobs in /jobs/ directory', async () => {
      createFile(
        tempDir,
        'src/jobs/email.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const emailJob = schemaTask({ id: 'email-job', run: async () => true });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
    });

    it('detects jobs in /workers/ directory', async () => {
      createFile(
        tempDir,
        'src/workers/background.ts',
        `import { Worker } from 'bullmq';
new Worker('background', async (job) => true);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
    });

    it('detects *.job.ts files', async () => {
      createFile(
        tempDir,
        'src/email.job.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const emailTask = schemaTask({ id: 'email-task', run: async () => true });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
    });

    it('detects *.worker.ts files', async () => {
      createFile(
        tempDir,
        'src/background.worker.ts',
        `import { Worker } from 'bullmq';
new Worker('worker-queue', async (job) => true);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
    });

    it('detects *.task.ts files', async () => {
      createFile(
        tempDir,
        'src/sync.task.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const syncTask = schemaTask({ id: 'sync-task', run: async () => true });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
    });
  });

  describe('multiple jobs in one file', () => {
    it('extracts all jobs from a file', async () => {
      createFile(
        tempDir,
        'src/tasks/notifications.ts',
        `import { schemaTask } from '@trigger.dev/sdk';

export const sendEmailTask = schemaTask({
  id: 'send-email',
  run: async () => true,
});

export const sendSmsTask = schemaTask({
  id: 'send-sms',
  run: async () => true,
});

export const sendPushTask = schemaTask({
  id: 'send-push',
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(3);
      expect(result.some((j) => j.name === 'send-email')).toBe(true);
      expect(result.some((j) => j.name === 'send-sms')).toBe(true);
      expect(result.some((j) => j.name === 'send-push')).toBe(true);
    });
  });

  describe('variable-based job definitions', () => {
    it('extracts trigger task assigned to variable', async () => {
      createFile(
        tempDir,
        'src/tasks/variable.ts',
        `import { schemaTask, task } from '@trigger.dev/sdk';
const myTask = task({
  id: 'my-task',
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('my-task');
    });

    it('extracts BullMQ worker assigned to variable', async () => {
      createFile(
        tempDir,
        'src/workers/variable.ts',
        `import { Worker } from 'bullmq';
const emailWorker = new Worker('email-queue', async (job) => {
  return true;
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('email-queue');
    });

    it('extracts Inngest function assigned to variable', async () => {
      createFile(
        tempDir,
        'src/inngest/variable.ts',
        `import { inngest } from './client';
const myFn = inngest.createFunction(
  { id: 'my-function' },
  { event: 'test' },
  async () => true
);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('my-function');
    });

    it('uses variable name when no id in custom job', async () => {
      createFile(
        tempDir,
        'src/jobs/noname.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
const processOrders = schemaTask({
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe('processOrders');
    });

    it('ignores non-call expression initializers', async () => {
      createFile(
        tempDir,
        'src/jobs/literal.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
const notATask = 'hello';
const alsoNotATask = { foo: 'bar' };`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('ignores unrelated call expressions', async () => {
      createFile(
        tempDir,
        'src/jobs/unrelated.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
const result = someOtherFunction({ id: 'test' });`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('job name extraction', () => {
    it('extracts name from id property', async () => {
      createFile(
        tempDir,
        'src/tasks/named.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const task1 = schemaTask({
  id: "booking.send.confirm.notifications",
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('booking.send.confirm.notifications');
    });

    it('extracts name from name property when no id', async () => {
      createFile(
        tempDir,
        'src/tasks/named2.ts',
        `import { task } from '@trigger.dev/sdk';
export const task2 = task({
  name: "custom-task-name",
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('custom-task-name');
    });

    it('extracts BullMQ queue name from constructor', async () => {
      createFile(
        tempDir,
        'src/workers/bullmq-named.ts',
        `import { Worker } from 'bullmq';
new Worker('my-special-queue', async (job) => true);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('my-special-queue');
    });

    it('extracts Inngest function id', async () => {
      createFile(
        tempDir,
        'src/inngest/named.ts',
        `import { inngest } from 'inngest';
export const fn = inngest.createFunction(
  { id: 'inngest-function-id' },
  { event: 'test' },
  async () => true
);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('inngest-function-id');
    });

    it('extracts Inngest function name when no id', async () => {
      createFile(
        tempDir,
        'src/inngest/named2.ts',
        `import { inngest } from 'inngest';
export const fn = createFunction(
  { name: 'inngest-function-name' },
  { event: 'test' },
  async () => true
);`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.name).toBe('inngest-function-name');
    });
  });

  describe('idempotency detection', () => {
    it('detects idempotency keyword in code', async () => {
      createFile(
        tempDir,
        'src/tasks/idempotent1.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const task = schemaTask({
  id: 'idempotent-task',
  run: async ({ jobId }) => {
    // idempotency check
    const existing = await db.job.findUnique({ where: { jobId } });
    if (existing) return existing;
    return db.job.create({ data: { id: jobId } });
  },
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('detects dedup pattern', async () => {
      createFile(
        tempDir,
        'src/tasks/idempotent2.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const task = schemaTask({
  id: 'dedup-task',
  run: async ({ jobId }) => {
    await deduplicate(jobId);
    return true;
  },
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('detects idempotent comment', async () => {
      createFile(
        tempDir,
        'src/tasks/idempotent3.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
// This task is idempotent by design
export const task = schemaTask({
  id: 'idempotent-marked-task',
  run: async () => true,
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('detects processedJobs pattern', async () => {
      createFile(
        tempDir,
        'src/tasks/idempotent4.ts',
        `import { schemaTask } from '@trigger.dev/sdk';
export const task = schemaTask({
  id: 'transactional-task',
  run: async ({ jobId }) => {
    await db.processedJobs.create({ data: { id: jobId } });
    return true;
  },
});`
      );

      const result = await extractJobs({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });
  });

  // Original integration test
  it('detects trigger.dev, bullmq, inngest and skips test files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-jobs-'));
    try {
      mkdirSync(join(dir, 'src', 'tasks'), { recursive: true });
      mkdirSync(join(dir, 'src', 'queues'), { recursive: true });
      mkdirSync(join(dir, 'src', 'inngest'), { recursive: true });

      writeFileSync(
        join(dir, 'src', 'tasks', 'email.task.ts'),
        `
import { schemaTask } from '@trigger.dev/sdk';
export const sendEmail = schemaTask({
  id: 'send-email',
  run: async () => {
    const alreadyProcessed = true;
    return alreadyProcessed;
  },
});
        `.trim()
      );

      writeFileSync(
        join(dir, 'src', 'queues', 'worker.ts'),
        `
import { Processor, Process } from '@nestjs/bull';

@Processor('billing')
export class BillingProcessor {
  @Process('charge')
  async handle(job: { id: string }) {
    await prisma.payment.upsert({ where: { jobId: job.id }, create: {}, update: {} });
  }
}
        `.trim()
      );

      writeFileSync(
        join(dir, 'src', 'queues', 'bullmq-worker.ts'),
        `
import { Worker } from 'bullmq';

new Worker('emails', async (job: { id: string }) => {
  await prisma.delivery.upsert({ where: { jobId: job.id }, create: {}, update: {} });
});
        `.trim()
      );

      writeFileSync(
        join(dir, 'src', 'inngest', 'sync.ts'),
        `
import { inngest } from 'inngest';
export const fn = inngest.createFunction({ id: 'sync-users' }, { event: 'users/sync' }, async () => {
  return { ok: true };
});
        `.trim()
      );

      // Should be excluded even though it's in /tasks/
      writeFileSync(
        join(dir, 'src', 'tasks', 'ignored.test.ts'),
        `
import { schemaTask } from '@trigger.dev/sdk';
export const shouldIgnore = schemaTask({ id: 'ignore-me', run: async () => true });
        `.trim()
      );

      const jobs = await extractJobs({ targetPath: dir, config: makeConfig() });

      expect(jobs.find((j) => j.framework === 'trigger' && j.name === 'send-email')).toMatchObject({
        hasIdempotencyCheck: true,
      });
      expect(jobs.find((j) => j.framework === 'bullmq' && j.name === 'billing:charge')).toMatchObject({
        hasIdempotencyCheck: true,
      });
      expect(jobs.find((j) => j.framework === 'bullmq' && j.name === 'emails')).toMatchObject({
        hasIdempotencyCheck: true,
      });
      expect(jobs.find((j) => j.framework === 'inngest' && j.name === 'sync-users')).toBeTruthy();

      expect(jobs.some((j) => j.name === 'ignore-me')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
