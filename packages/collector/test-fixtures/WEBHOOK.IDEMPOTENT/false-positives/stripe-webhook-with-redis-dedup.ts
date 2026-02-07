// @fixture: false-positive
// @invariant: WEBHOOK.IDEMPOTENT
// @expected-findings: 0
// @description: Stripe webhook with proper Redis-based idempotency

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { sendEmail } from '@/lib/email';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Stripe webhook handler WITH proper idempotency
 * This should NOT be flagged
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  // Extract event ID for idempotency
  const eventId = event.id;

  // Check if already processed
  const processed = await redis.get(`webhook:stripe:${eventId}`);
  if (processed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Mark as processing (with TTL)
  await redis.set(`webhook:stripe:${eventId}`, 'processing', 'EX', 86400);

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      await db.order.create({
        data: {
          stripeSessionId: session.id,
          stripeEventId: eventId, // Store for reference
          customerId: session.customer as string,
          amount: session.amount_total!,
        },
      });

      await sendEmail({
        to: session.customer_email!,
        subject: 'Order Confirmed',
        body: 'Thank you for your order!',
      });
    }

    // Mark as completed
    await redis.set(`webhook:stripe:${eventId}`, 'completed', 'EX', 86400);
  } catch (error) {
    // Remove marker so retry can work
    await redis.del(`webhook:stripe:${eventId}`);
    throw error;
  }

  return NextResponse.json({ received: true });
}
