// @fixture: true-positive
// @invariant: TRANSACTION.POST_COMMIT.SIDE_EFFECTS
// @expected-findings: 1
// @description: External webhook call inside Prisma transaction

import { db } from '@/lib/db';

/**
 * Notifies external service inside transaction
 * This should be flagged - external call happens before commit
 */
export async function updateSubscriptionAndNotify(
  subscriptionId: string,
  newPlan: string
) {
  return db.$transaction(async (tx) => {
    const subscription = await tx.subscription.update({
      where: { id: subscriptionId },
      data: { plan: newPlan },
    });

    // BUG: External API call inside transaction
    // If transaction rolls back, external system has stale data
    await fetch('https://analytics.example.com/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'subscription.updated',
        subscriptionId,
        newPlan,
      }),
    });

    // This might fail!
    await tx.billingHistory.create({
      data: {
        subscriptionId,
        event: 'plan_changed',
        oldPlan: subscription.plan,
        newPlan,
      },
    });

    return subscription;
  });
}
