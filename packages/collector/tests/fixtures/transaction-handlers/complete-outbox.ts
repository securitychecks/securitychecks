/**
 * COMPLETE: Outbox Pattern with Rollback Test
 *
 * This handler uses the outbox pattern - side effects are queued
 * in the same transaction and processed by a separate worker.
 *
 * Expected findings:
 * - None (clean implementation with accompanying test)
 */

import { db } from './services';

interface OrderData {
  customerId: string;
  amount: number;
  email: string;
}

export async function createOrderWithOutbox(orderData: OrderData) {
  return db.$transaction(async (tx) => {
    // Create the order
    const order = await tx.order.create({
      data: {
        customerId: orderData.customerId,
        amount: orderData.amount,
      },
    });

    // Queue email via outbox (same transaction!)
    // If transaction fails, this is rolled back too
    await tx.outbox.create({
      data: {
        type: 'SEND_EMAIL',
        payload: JSON.stringify({
          to: orderData.email,
          subject: 'Order Confirmed!',
          body: `Your order ${order.id} has been placed.`,
        }),
        scheduledFor: new Date(),
      },
    });

    return order;
  });
}

// Separate worker processes the outbox
export async function processOutboxEvents() {
  // This runs separately and only processes committed events
  // Implementation details omitted for brevity
}
