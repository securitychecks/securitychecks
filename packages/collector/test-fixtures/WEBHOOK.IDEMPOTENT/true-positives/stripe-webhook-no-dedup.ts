// @fixture: true-positive
// @invariant: WEBHOOK.IDEMPOTENT
// @expected-findings: 1
// @description: Stripe webhook handler without idempotency protection

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Stripe webhook handler WITHOUT idempotency
 * This should be flagged - replaying webhook will send duplicate emails
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  // No event ID extraction
  // No check if we've already processed this event

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Side effect without deduplication
    await db.order.create({
      data: {
        stripeSessionId: session.id,
        customerId: session.customer as string,
        amount: session.amount_total!,
      },
    });

    // Email will be sent AGAIN if webhook is replayed
    await sendEmail({
      to: session.customer_email!,
      subject: 'Order Confirmed',
      body: 'Thank you for your order!',
    });
  }

  return NextResponse.json({ received: true });
}
