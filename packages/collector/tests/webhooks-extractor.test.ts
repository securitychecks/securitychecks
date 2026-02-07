/**
 * Unit tests for webhooks extractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractWebhooks } from '../src/extractors/webhooks.js';
import type { AuditConfig } from '../src/types.js';

function makeConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  return {
    version: '1.0',
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testPatterns: ['**/*.test.ts'],
    servicePatterns: ['**/*.service.ts'],
    authzFunctions: [],
    ...overrides,
  };
}

function createFile(basePath: string, relativePath: string, content: string): void {
  const fullPath = join(basePath, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('webhooks extractor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-webhooks-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('empty project', () => {
    it('returns empty array when no files', async () => {
      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('stripe webhook detection', () => {
    it('detects stripe webhook handler by function name', async () => {
      createFile(
        tempDir,
        'src/webhooks/stripe.ts',
        `export async function handleStripeWebhook(req: Request) {
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('stripe');
      expect(result[0]?.signatureVerification?.method).toBe('stripe_construct_event');
    });

    it('detects stripe event ID extraction', async () => {
      createFile(
        tempDir,
        'src/webhooks/stripe.ts',
        `export async function handleStripeWebhook(req: Request) {
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  const eventId = event.id;
  await db.processedEvents.create({ eventId });
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.eventIdExtraction?.method).toBe('stripe_event_id');
    });
  });

  describe('github webhook detection', () => {
    it('detects github webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/github.ts',
        `export async function handleGithubEvent(req: Request) {
  const signature = req.headers.get('x-hub-signature-256');
  const deliveryId = req.headers.get('x-github-delivery');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('github');
      expect(result[0]?.signatureVerification?.method).toBe('github_signature');
      expect(result[0]?.eventIdExtraction?.method).toBe('github_delivery');
    });
  });

  describe('slack webhook detection', () => {
    it('detects slack webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/slack.ts',
        `export async function handleSlackEvent(req: Request) {
  const signature = req.headers.get('x-slack-signature');
  const eventId = body.event_id;
  return { ok: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('slack');
      expect(result[0]?.signatureVerification?.method).toBe('slack_signature');
    });
  });

  describe('clerk webhook detection', () => {
    it('detects clerk webhook with svix verification', async () => {
      createFile(
        tempDir,
        'src/webhooks/clerk.ts',
        `import { Webhook } from 'svix';
export async function handleClerkEvent(req: Request) {
  const wh = new Webhook(secret);
  const svixId = req.headers.get('svix-id');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('clerk');
      expect(result[0]?.signatureVerification?.method).toBe('svix_verify');
    });
  });

  describe('paddle webhook detection', () => {
    it('detects paddle webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/paddle.ts',
        `export async function handlePaddleEvent(req: Request) {
  const signature = req.headers.get('p-signature');
  const eventId = body.event_id;
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('paddle');
      expect(result[0]?.signatureVerification?.method).toBe('paddle_signature');
    });
  });

  describe('twilio webhook detection', () => {
    it('detects twilio webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/twilio.ts',
        `export async function handleTwilioEvent(req: Request) {
  const signature = req.headers.get('x-twilio-signature');
  const messageSid = body.MessageSid;
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('twilio');
    });
  });

  describe('shopify webhook detection', () => {
    it('detects shopify webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/shopify.ts',
        `export async function handleShopifyEvent(req: Request) {
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const webhookId = req.headers.get('x-shopify-webhook-id');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('shopify');
    });
  });

  describe('paypal webhook detection', () => {
    it('detects paypal webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/paypal.ts',
        `export async function handlePaypalEvent(req: Request) {
  const transmissionId = req.headers.get('x-paypal-transmission-id');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('paypal');
    });
  });

  describe('lemonsqueezy webhook detection', () => {
    it('detects lemonsqueezy webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/lemonsqueezy.ts',
        `export async function handleLemonSqueezyEvent(req: Request) {
  const eventId = body.meta.event_id;
  const signature = req.headers.get('x-signature');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('lemonsqueezy');
    });
  });

  describe('idempotency detection', () => {
    it('detects idempotency check via eventId pattern', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  const eventId = event.id;
  if (await isAlreadyProcessed(eventId)) {
    return { duplicate: true };
  }
  await processEvent(event);
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('detects idempotency check via processedEvents pattern', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  const existing = await db.processedEvents.findUnique({ id: event.id });
  if (existing) return { ok: true };
  await db.processedEvents.create({ id: event.id });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('detects idempotency via withLock pattern', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  await withLock(event.id, async () => {
    await processEvent(event);
  });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('detects idempotency via acquireLock pattern', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  const lock = await acquireLock(event.id);
  try {
    await processEvent(event);
  } finally {
    lock.release();
  }
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(true);
    });

    it('does NOT detect idempotency from comments', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  // TODO: Add idempotency check for eventId
  // processedEvents pattern should be added here
  await processEvent(event);
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.hasIdempotencyCheck).toBe(false);
    });
  });

  describe('persistence marker detection', () => {
    it('detects database persistence via prisma create', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  await db.processedWebhookEvent.create({ data: { eventId: event.id } });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.persistenceMarker?.type).toBe('database');
    });

    it('detects cache persistence via redis', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  await redis.set('event:' + event.id, '1');
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.persistenceMarker?.type).toBe('cache');
    });

    it('detects wrapper function persistence', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  const result = await tryProcessWebhook(event.id, 'stripe', event.type);
  if (!result) return;
  await handleEvent(event);
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.persistenceMarker?.type).toBe('database');
    });
  });

  describe('event type extraction', () => {
    it('extracts event types from switch cases', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  switch (event.type) {
    case 'payment.succeeded':
      await handlePaymentSuccess(event);
      break;
    case 'payment.failed':
      await handlePaymentFailed(event);
      break;
  }
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.eventTypes).toContain('payment.succeeded');
      expect(result[0]?.eventTypes).toContain('payment.failed');
    });

    it('extracts event types from if statements', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  if (event.type === 'invoice.paid') {
    await handleInvoicePaid(event);
  }
  if (event.type === 'invoice.failed') {
    await handleInvoiceFailed(event);
  }
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.eventTypes).toContain('invoice.paid');
      expect(result[0]?.eventTypes).toContain('invoice.failed');
    });
  });

  describe('event type idempotency detection', () => {
    it('detects partial idempotency per event type', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  switch (event.type) {
    case 'payment.succeeded':
      if (await isProcessed(event.id)) return;
      await handlePaymentSuccess(event);
      await markProcessed(event.id);
      break;
    case 'payment.failed':
      // No idempotency for failed payments
      await handlePaymentFailed(event);
      break;
  }
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.eventTypeIdempotency).toBeDefined();
      const succeeded = result[0]?.eventTypeIdempotency?.find(
        (e) => e.eventType === 'payment.succeeded'
      );
      const failed = result[0]?.eventTypeIdempotency?.find(
        (e) => e.eventType === 'payment.failed'
      );
      expect(succeeded?.hasIdempotency).toBe(true);
      expect(failed?.hasIdempotency).toBe(false);
    });
  });

  describe('route detection', () => {
    it('detects webhook via Express route pattern', async () => {
      createFile(
        tempDir,
        'src/webhooks/routes.ts',
        `app.post('/webhook/stripe', async (req, res) => {
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  res.json({ received: true });
});`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.provider).toBe('stripe');
    });
  });

  describe('non-handler exclusions', () => {
    it('excludes React components', async () => {
      createFile(
        tempDir,
        'src/components/WebhookList.tsx',
        `export function WebhookList() {
  const webhooks = useWebhooks();
  return <ul>{webhooks.map(w => <li key={w.id}>{w.name}</li>)}</ul>;
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes test files', async () => {
      createFile(
        tempDir,
        'src/__tests__/webhook.test.ts',
        `describe('webhook handler', () => {
  it('handles stripe webhook', async () => {
    await handleStripeWebhook(mockReq);
  });
});`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes webhook management API files', async () => {
      createFile(
        tempDir,
        'src/api/webhooks/route.ts',
        `export async function GET() {
  const webhooks = await prisma.webhook.findMany();
  return Response.json(webhooks);
}

export async function POST() {
  const webhook = await prisma.webhook.create({
    data: { url, events }
  });
  return Response.json(webhook);
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes webhook CRUD functions', async () => {
      createFile(
        tempDir,
        'src/services/webhook.ts',
        `export async function createWebhook(url: string, events: string[]) {
  return db.webhook.create({ data: { url, events } });
}

export async function deleteWebhook(id: string) {
  return db.webhook.delete({ where: { id } });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });

    it('excludes webhook sending functions', async () => {
      createFile(
        tempDir,
        'src/services/notifications.ts',
        `export async function sendWebhook(url: string, payload: unknown) {
  await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result).toEqual([]);
    });
  });

  describe('Next.js app router detection', () => {
    it('detects POST handler as webhook', async () => {
      createFile(
        tempDir,
        'app/api/webhooks/stripe/route.ts',
        `export async function POST(req: Request) {
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  return Response.json({ received: true });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.handlerName).toBe('POST');
    });
  });

  describe('signature verification detection', () => {
    it('detects generic HMAC verification', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  const signature = crypto.createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  if (!timingSafeEqual(signature, provided)) {
    throw new Error('Invalid signature');
  }
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.signatureVerification?.method).toBe('generic_hmac');
    });
  });

  describe('handler signature detection', () => {
    it('detects handler with req/res parameters', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `function webhookHandler(req, res) {
  const event = req.body;
  res.json({ received: true });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
    });

    it('detects handler with context parameter', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function webhookHandler(ctx) {
  const event = ctx.body;
  ctx.status = 200;
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('helper function exclusion', () => {
    it('excludes processEvent helper via NON_HANDLER_FUNCTION_PATTERNS', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `// Entry point handler
export async function handleStripeWebhook(req: Request) {
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  await processEvent(event);
}

// Helper function - should be excluded by NON_HANDLER_FUNCTION_PATTERNS
function processEvent(payload) {
  switch (payload.type) {
    case 'payment.succeeded':
      return handlePayment(payload);
  }
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      // Should detect handleStripeWebhook
      expect(result.some((h) => h.handlerName === 'handleStripeWebhook')).toBe(true);
      // processEvent should NOT be detected (matches /^process.*Event/i in NON_HANDLER_FUNCTION_PATTERNS)
      expect(result.some((h) => h.handlerName === 'processEvent')).toBe(false);
    });

    it('excludes createWebhook management function', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export async function handleWebhook(req: Request) {
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  return { received: true };
}

// Management function - should be excluded
export async function createWebhook(url: string) {
  return db.webhook.create({ data: { url } });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      // Should detect handleWebhook
      expect(result.some((h) => h.handlerName === 'handleWebhook')).toBe(true);
      // createWebhook should NOT be detected (matches /^create.*Webhook/i)
      expect(result.some((h) => h.handlerName === 'createWebhook')).toBe(false);
    });
  });

  describe('provider-specific event ID extraction', () => {
    it('detects resend event ID via svix-id header', async () => {
      createFile(
        tempDir,
        'src/webhooks/resend.ts',
        `export async function handleResendEvent(req: Request) {
  const svixId = req.headers.get('svix-id');
  const webhookId = req.headers.get('x-resend-webhook-id');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.provider).toBe('resend');
    });

    it('detects sendgrid event ID', async () => {
      createFile(
        tempDir,
        'src/webhooks/sendgrid.ts',
        `export async function handleWebhook(req: Request) {
  const eventId = body.sg_event_id;
  const messageId = body.sg_message_id;
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.provider).toBe('sendgrid');
    });

    it('detects postmark event ID', async () => {
      createFile(
        tempDir,
        'src/webhooks/postmark.ts',
        `export async function handleWebhook(req: Request) {
  const messageId = body.MessageID;
  const uniqueId = req.headers.get('x-postmark-unique-id');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.provider).toBe('postmark');
    });

    it('detects plaid event ID', async () => {
      createFile(
        tempDir,
        'src/webhooks/plaid.ts',
        `export async function handlePlaidEvent(req: Request) {
  const itemId = body.item_id;
  const webhookCode = body.webhook_code;
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.provider).toBe('plaid');
    });
  });

  describe('generic fallback detection', () => {
    it('detects generic webhook with x-request-id', async () => {
      createFile(
        tempDir,
        'src/webhooks/custom.ts',
        `export async function handleWebhook(req: Request) {
  const requestId = req.headers.get('x-request-id');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.eventIdExtraction?.method).toBe('header');
    });

    it('detects generic webhook with idempotency-key header', async () => {
      createFile(
        tempDir,
        'src/webhooks/custom.ts',
        `export async function handleWebhook(req: Request) {
  const idempotencyKey = req.headers.get('idempotency-key');
  return { received: true };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result[0]?.eventIdExtraction?.method).toBe('header');
    });
  });

  describe('file path pattern matching', () => {
    it('detects webhook from /webhooks/ path', async () => {
      createFile(
        tempDir,
        'src/api/webhooks/generic.ts',
        `export async function POST(req: Request) {
  return Response.json({ ok: true });
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
    });

    it('excludes React hooks folder', async () => {
      // /hooks/ pattern is excluded because it's ambiguous (could be React hooks folder)
      createFile(
        tempDir,
        'src/hooks/useWebhook.ts',
        `export function useWebhook() {
  return { data: [] };
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      // Should be excluded as it's in /hooks/ folder (React hooks)
      expect(result).toEqual([]);
    });
  });

  describe('arrow function handlers', () => {
    it('detects arrow function webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/handler.ts',
        `export const handleWebhook = async (req: Request) => {
  const event = stripe.webhooks.constructEvent(body, sig, secret);
  return Response.json({ received: true });
};`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.handlerName).toBe('handleWebhook');
    });
  });

  describe('method declaration handlers', () => {
    it('detects class method webhook handler', async () => {
      createFile(
        tempDir,
        'src/webhooks/controller.ts',
        `export class WebhooksController {
  async handleStripeWebhook(req: Request) {
    const event = stripe.webhooks.constructEvent(body, sig, secret);
    return { received: true };
  }
}`
      );

      const result = await extractWebhooks({
        targetPath: tempDir,
        config: makeConfig(),
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.handlerName).toBe('handleStripeWebhook');
    });
  });
});
