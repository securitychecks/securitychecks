// @fixture: false-positive
// @invariant: TRANSACTION.POST_COMMIT.SIDE_EFFECTS
// @expected-findings: 0
// @description: Email sent AFTER transaction commits

import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';

/**
 * Creates order with email AFTER transaction
 * This should NOT be flagged - side effect is after commit
 */
export async function createOrderWithEmail(userId: string, items: OrderItem[]) {
  // Transaction handles database operations only
  const order = await db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
        status: 'pending',
      },
    });

    await tx.orderItem.createMany({
      data: items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
      })),
    });

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

  // Email sent AFTER transaction commits - correct!
  await sendEmail({
    to: 'user@example.com',
    subject: 'Order Confirmed',
    body: `Order ${order.id} has been placed`,
  });

  return order;
}

interface OrderItem {
  productId: string;
  quantity: number;
}
