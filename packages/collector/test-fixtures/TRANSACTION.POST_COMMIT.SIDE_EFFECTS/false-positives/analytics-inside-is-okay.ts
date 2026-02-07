// @fixture: false-positive
// @invariant: TRANSACTION.POST_COMMIT.SIDE_EFFECTS
// @expected-findings: 0
// @description: Analytics tracking inside transaction is acceptable (fire-and-forget)

import { db } from '@/lib/db';
import { analytics } from '@/lib/analytics';

/**
 * Analytics inside transaction - acceptable
 * This should NOT be flagged - analytics are fire-and-forget, idempotent
 */
export async function createUserWithTracking(email: string, name: string) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name },
    });

    // Analytics tracking is acceptable inside transaction because:
    // 1. It's fire-and-forget (doesn't affect user flow)
    // 2. Duplicate events are handled by analytics platform
    // 3. Missing events are acceptable (not critical)
    analytics.track('user_created', {
      userId: user.id,
      email: user.email,
    });

    return user;
  });
}
