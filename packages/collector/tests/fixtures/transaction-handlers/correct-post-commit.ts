/**
 * CORRECT: Post-Commit Pattern
 *
 * This handler moves side effects OUTSIDE the transaction.
 * Email is only sent after the transaction successfully commits.
 *
 * Expected findings:
 * - None for the transaction itself (side effects are outside)
 * - P1: No rollback test (optional, could be added)
 */

import { db, emailService } from './services';

interface OrderData {
  customerId: string;
  amount: number;
  email: string;
}

export async function createOrderCorrectly(orderData: OrderData) {
  // Transaction only contains database operations
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        customerId: orderData.customerId,
        amount: orderData.amount,
      },
    });

    await tx.order.create({
      data: {
        parentOrderId: order.id,
        type: 'AUDIT_LOG',
      },
    });

    // Return intent, don't execute
    return {
      order,
      shouldSendEmail: true,
      emailRecipient: orderData.email,
    };
  });

  // CORRECT: Side effect AFTER transaction commits
  if (result.shouldSendEmail) {
    await emailService.send({
      to: result.emailRecipient,
      subject: 'Order Confirmed!',
      body: `Your order ${result.order.id} has been placed.`,
    });
  }

  return result.order;
}
