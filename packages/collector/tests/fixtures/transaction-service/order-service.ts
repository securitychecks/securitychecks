/**
 * Test fixture for TRANSACTION.POST_COMMIT.SIDE_EFFECTS checker
 */

import { prisma } from './db';
import { sendEmail } from './email';
import { sendWebhook } from './webhook';

export async function createOrder(userId: string, items: any[]) {
  // BAD: Side effect inside transaction
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: { userId, items },
    });

    // This email might send even if the transaction rolls back!
    await sendEmail({
      to: 'user@example.com',
      subject: 'Order Created',
      body: `Your order ${order.id} has been created`,
    });

    return order;
  });
}

export async function processPayment(orderId: string, amount: number) {
  // BAD: Webhook inside transaction
  return prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: { orderId, amount, status: 'completed' },
    });

    // This webhook fires before commit!
    await sendWebhook({
      event: 'payment.completed',
      data: { orderId, amount },
    });
  });
}

export async function updateInventory(productId: string, quantity: number) {
  // GOOD: No side effects inside transaction
  await prisma.$transaction(async (tx) => {
    await tx.inventory.update({
      where: { productId },
      data: { quantity: { decrement: quantity } },
    });

    await tx.inventoryLog.create({
      data: { productId, change: -quantity },
    });
  });
}
