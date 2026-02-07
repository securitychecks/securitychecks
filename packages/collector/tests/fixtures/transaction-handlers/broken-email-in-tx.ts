/**
 * BROKEN: Email Inside Transaction
 *
 * This handler sends an email INSIDE the transaction.
 * If the transaction rolls back, the email is already sent.
 *
 * Expected findings:
 * - P0: Transaction contains email side effect
 * - P1: No rollback test
 */

import { db, emailService } from './services';

interface OrderData {
  customerId: string;
  amount: number;
  email: string;
}

export async function createOrderWithEmail(orderData: OrderData) {
  return db.$transaction(async (tx) => {
    // Create the order
    const order = await tx.order.create({
      data: {
        customerId: orderData.customerId,
        amount: orderData.amount,
      },
    });

    // BUG: Email sent INSIDE transaction!
    // If anything fails after this, customer gets email for non-existent order
    await emailService.send({
      to: orderData.email,
      subject: 'Order Confirmed!',
      body: `Your order ${order.id} has been placed.`,
    });

    // If this fails, email already sent but order doesn't exist
    await tx.order.create({
      data: {
        parentOrderId: order.id,
        type: 'AUDIT_LOG',
      },
    });

    return order;
  });
}
