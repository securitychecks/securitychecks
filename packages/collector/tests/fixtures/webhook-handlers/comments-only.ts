/**
 * Generic Webhook Handler - COMMENTS ONLY (FALSE POSITIVE TEST)
 *
 * This file contains mentions of "idempotency" and "event.id" in comments
 * but has NO actual idempotency implementation.
 *
 * The checker should NOT be fooled by these comments and should still
 * flag this as a P0 violation.
 *
 * TODO: Add idempotency check using event.id
 * TODO: Store processedEvents in the database
 * NOTE: Remember to make this idempotent before production!
 */

export async function handleGenericWebhook(req: Request, res: Response) {
  const body = await req.text();
  const payload = JSON.parse(body);

  // TODO: Extract event.id for idempotency
  // We should check if this event has already been processed
  // The idempotent behavior would prevent duplicate processing

  switch (payload.type) {
    case 'order.created':
      // Idempotency would be nice here...
      await createOrder(payload.data);
      break;

    case 'user.updated':
      // Should probably check for duplicates
      await updateUserProfile(payload.data);
      break;

    case 'notification.send':
      // NOTE: This is NOT idempotent - duplicates will send multiple emails
      await sendNotification(payload.data);
      break;
  }

  // We really should add event.id deduplication here
  // Missing: processedEvents.create({ eventId: ... })

  return res.status(200).json({ received: true });
}

// Simulated helpers
async function createOrder(_data: unknown) {}
async function updateUserProfile(_data: unknown) {}
async function sendNotification(_data: unknown) {}

interface Request {
  headers: Record<string, string | undefined>;
  text(): Promise<string>;
}

interface Response {
  status(code: number): Response;
  send(body: string): void;
  json(body: unknown): void;
}
