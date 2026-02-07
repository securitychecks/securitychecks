// @fixture: false-positive
// @invariant: WEBHOOK.IDEMPOTENT
// @expected-findings: 0
// @description: Stripe webhook with database-based idempotency

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Stripe webhook handler WITH database idempotency
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

  // Check if event already processed using database
  const existingEvent = await db.processedWebhookEvent.findUnique({
    where: { eventId: event.id },
  });

  if (existingEvent) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record event before processing (prevents race conditions)
  await db.processedWebhookEvent.create({
    data: {
      eventId: event.id,
      eventType: event.type,
      processedAt: new Date(),
    },
  });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    await db.order.create({
      data: {
        stripeSessionId: session.id,
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

  return NextResponse.json({ received: true });
}
