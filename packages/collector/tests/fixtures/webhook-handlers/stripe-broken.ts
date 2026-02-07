/**
 * Stripe Webhook Handler - NO IDEMPOTENCY PROTECTION
 *
 * This handler has NO event ID extraction, NO persistence,
 * and NO deduplication. This should trigger a P0 finding.
 */

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'];
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('Webhook signature verification failed');
    return res.status(400).send('Invalid signature');
  }

  // Process events WITHOUT any idempotency checks
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      // DANGER: This will send duplicate emails if webhook is replayed
      await sendPaymentConfirmationEmail(paymentIntent.customer);
      await updateDatabasePaymentStatus(paymentIntent.id, 'paid');
      break;

    case 'customer.subscription.created':
      const subscription = event.data.object;
      // DANGER: This could create duplicate subscriptions
      await createSubscriptionRecord(subscription);
      break;
  }

  return res.status(200).json({ received: true });
}

// Simulated helpers
async function sendPaymentConfirmationEmail(_customer: unknown) {}
async function updateDatabasePaymentStatus(_id: string, _status: string) {}
async function createSubscriptionRecord(_subscription: unknown) {}

interface Request {
  headers: Record<string, string | undefined>;
  text(): Promise<string>;
}

interface Response {
  status(code: number): Response;
  send(body: string): void;
  json(body: unknown): void;
}
