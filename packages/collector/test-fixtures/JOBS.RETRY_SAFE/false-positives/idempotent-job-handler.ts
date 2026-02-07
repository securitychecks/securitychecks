// @fixture: false-positive
// @invariant: JOBS.RETRY_SAFE
// @expected-findings: 0
// @description: Background job handler with proper idempotency

import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { chargeCard } from '@/lib/stripe';

/**
 * Process order job WITH idempotency
 * This should NOT be flagged
 */
export async function processOrderJob(payload: { orderId: string; jobId: string }) {
  const order = await db.order.findUnique({
    where: { id: payload.orderId },
    include: { user: true, items: true },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  // Check if already processed
  if (order.status === 'paid') {
    console.log(`Order ${order.id} already paid, skipping`);
    return;
  }

  // Check for existing job record
  const existingJob = await db.processedJob.findUnique({
    where: { jobId: payload.jobId },
  });

  if (existingJob) {
    console.log(`Job ${payload.jobId} already processed`);
    return;
  }

  // Record job before processing
  await db.processedJob.create({
    data: { jobId: payload.jobId, orderId: order.id },
  });

  // Use idempotency key for Stripe
  const charge = await chargeCard({
    customerId: order.user.stripeCustomerId,
    amount: order.total,
    idempotencyKey: `order-${order.id}`,
  });

  await db.order.update({
    where: { id: order.id },
    data: { status: 'paid', chargeId: charge.id },
  });

  // Email is idempotent by checking order status
  if (order.emailSent !== true) {
    await sendEmail({
      to: order.user.email,
      subject: 'Payment Received',
      body: `Your payment of $${order.total / 100} was successful.`,
    });

    await db.order.update({
      where: { id: order.id },
      data: { emailSent: true },
    });
  }
}
