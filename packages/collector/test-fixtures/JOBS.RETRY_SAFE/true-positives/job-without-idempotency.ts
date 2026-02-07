// @fixture: true-positive
// @invariant: JOBS.RETRY_SAFE
// @expected-findings: 1
// @description: Background job handler without idempotency protection

import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { chargeCard } from '@/lib/stripe';

/**
 * Process order job WITHOUT idempotency
 * This should be flagged - retrying will cause duplicate charges
 */
export async function processOrderJob(payload: { orderId: string }) {
  const order = await db.order.findUnique({
    where: { id: payload.orderId },
    include: { user: true, items: true },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  // No check if order was already processed
  // No idempotency key for payment

  // BUG: Will charge again on retry!
  const charge = await chargeCard({
    customerId: order.user.stripeCustomerId,
    amount: order.total,
  });

  await db.order.update({
    where: { id: order.id },
    data: { status: 'paid', chargeId: charge.id },
  });

  // BUG: Will send duplicate emails on retry!
  await sendEmail({
    to: order.user.email,
    subject: 'Payment Received',
    body: `Your payment of $${order.total / 100} was successful.`,
  });
}

/**
 * Send notification job - no dedup
 */
export async function sendNotificationJob(payload: {
  userId: string;
  message: string;
}) {
  const user = await db.user.findUnique({
    where: { id: payload.userId },
  });

  // No tracking of sent notifications
  // Will send duplicates on retry
  await sendEmail({
    to: user!.email,
    subject: 'Notification',
    body: payload.message,
  });
}
