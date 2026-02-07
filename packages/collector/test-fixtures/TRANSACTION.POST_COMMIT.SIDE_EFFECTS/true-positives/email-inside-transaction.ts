// @fixture: true-positive
// @invariant: TRANSACTION.POST_COMMIT.SIDE_EFFECTS
// @expected-findings: 1
// @description: Email sent inside database transaction

import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';

/**
 * Creates order with email INSIDE transaction
 * This should be flagged - if transaction rolls back, email already sent
 */
export async function createOrderWithEmail(userId: string, items: OrderItem[]) {
  return db.$transaction(async (tx) => {
    // Create order
    const order = await tx.order.create({
      data: {
        userId,
        status: 'pending',
      },
    });

    // Create line items
    await tx.orderItem.createMany({
      data: items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
      })),
    });

    // BUG: Email sent inside transaction!
    // If anything below fails, email already sent but order doesn't exist
    await sendEmail({
      to: 'user@example.com',
      subject: 'Order Confirmed',
      body: `Order ${order.id} has been placed`,
    });

    // Deduct inventory (might fail!)
    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          inventory: { decrement: item.quantity },
        },
      });
    }

    return order;
  });
}

interface OrderItem {
  productId: string;
  quantity: number;
}
