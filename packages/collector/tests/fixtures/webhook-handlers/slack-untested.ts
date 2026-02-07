/**
 * Slack Webhook Handler - HAS IDEMPOTENCY BUT NO TEST
 *
 * This handler has proper idempotency implementation:
 * - Extracts event_id from payload
 * - Persists to database before processing
 * - Returns early on duplicates
 *
 * BUT there's no test verifying this works!
 * This should trigger a P1 finding.
 */

import { db } from './db';

export async function handleSlackWebhook(req: Request, res: Response) {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  const body = await req.text();

  // Verify signature (simplified)
  if (!verifySlackSignature(body, timestamp!, signature!)) {
    return res.status(401).send('Invalid signature');
  }

  const payload = JSON.parse(body);
  const eventId = payload.event_id; // Extract event ID

  // Idempotency check: have we seen this event before?
  const existing = await db.processedEvents.findFirst({
    where: { eventId, source: 'slack' },
  });

  if (existing) {
    console.log(`Duplicate Slack event ${eventId}, skipping`);
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // Mark as processed BEFORE handling (prevents race conditions)
  await db.processedEvents.create({
    data: { eventId, source: 'slack', processedAt: new Date() },
  });

  // Now safe to process
  switch (payload.event.type) {
    case 'message':
      await handleMessage(payload.event);
      break;
    case 'app_mention':
      await handleMention(payload.event);
      break;
    case 'reaction_added':
      await handleReaction(payload.event);
      break;
  }

  return res.status(200).json({ ok: true });
}

function verifySlackSignature(_body: string, _timestamp: string, _signature: string): boolean {
  // Simplified - real impl would verify HMAC
  return true;
}

async function handleMessage(_event: unknown) {}
async function handleMention(_event: unknown) {}
async function handleReaction(_event: unknown) {}

interface Request {
  headers: Record<string, string | undefined>;
  text(): Promise<string>;
}

interface Response {
  status(code: number): Response;
  send(body: string): void;
  json(body: unknown): void;
}
