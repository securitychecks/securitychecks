/**
 * BROKEN: Webhook Inside Transaction
 *
 * This handler calls an external webhook INSIDE the transaction.
 * If the transaction rolls back, the webhook was already fired.
 *
 * Expected findings:
 * - P0: Transaction contains webhook side effect
 * - P1: No rollback test
 */

import { db, webhookService } from './services';

interface PaymentData {
  userId: string;
  amount: number;
  webhookUrl: string;
}

export async function processPaymentWithWebhook(paymentData: PaymentData) {
  return db.$transaction(async (tx) => {
    // Create payment record
    const payment = await tx.order.create({
      data: {
        userId: paymentData.userId,
        amount: paymentData.amount,
        type: 'PAYMENT',
      },
    });

    // BUG: Webhook called INSIDE transaction!
    // External system is notified before we're sure the payment is committed
    await fetch(paymentData.webhookUrl, {
      method: 'POST',
      body: JSON.stringify({
        event: 'payment.completed',
        paymentId: payment.id,
        amount: paymentData.amount,
      }),
    });

    // If this constraint fails, webhook already fired but payment doesn't exist
    await tx.order.create({
      data: {
        paymentId: payment.id,
        type: 'LEDGER_ENTRY',
      },
    });

    return payment;
  });
}
