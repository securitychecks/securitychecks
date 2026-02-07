/**
 * Svix Webhook Handler - COMPLETE IMPLEMENTATION
 *
 * This handler has:
 * - Event ID extraction (svix-id header)
 * - Database persistence
 * - Idempotency check before processing
 * - An accompanying test file
 *
 * This should NOT generate any findings.
 */

import { Webhook } from 'svix';
import { db } from './db';

const webhook = new Webhook(process.env.SVIX_WEBHOOK_SECRET!);

export async function handleSvixWebhook(req: Request, res: Response) {
  const svixId = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];
  const body = await req.text();

  // Verify the webhook signature
  let payload: WebhookPayload;
  try {
    payload = webhook.verify(body, {
      'svix-id': svixId!,
      'svix-timestamp': svixTimestamp!,
      'svix-signature': svixSignature!,
    }) as WebhookPayload;
  } catch (err) {
    console.error('Svix webhook verification failed:', err);
    return res.status(400).send('Invalid signature');
  }

  // Idempotency check using svix message ID
  const messageId = svixId;
  const alreadyProcessed = await db.processedEvents.findFirst({
    where: { eventId: messageId, source: 'svix' },
  });

  if (alreadyProcessed) {
    console.log(`Duplicate Svix message ${messageId}, returning early`);
    return res.status(200).json({ ok: true, skipped: true });
  }

  // Persist before processing to prevent duplicates from races
  await db.processedEvents.create({
    data: {
      eventId: messageId!,
      source: 'svix',
      eventType: payload.eventType,
      processedAt: new Date(),
    },
  });

  // Safe to process now
  await processWebhookPayload(payload);

  return res.status(200).json({ ok: true });
}

async function processWebhookPayload(payload: WebhookPayload) {
  console.log(`Processing ${payload.eventType}:`, payload.data);
  // Business logic here
}

interface WebhookPayload {
  eventType: string;
  data: Record<string, unknown>;
}

interface Request {
  headers: Record<string, string | undefined>;
  text(): Promise<string>;
}

interface Response {
  status(code: number): Response;
  send(body: string): void;
  json(body: unknown): void;
}
