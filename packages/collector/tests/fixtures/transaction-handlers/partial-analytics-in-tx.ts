/**
 * PARTIAL: Analytics Inside Transaction
 *
 * This handler tracks analytics INSIDE the transaction.
 * Lower risk than email/webhook, but still incorrect pattern.
 *
 * Expected findings:
 * - P1: Transaction contains analytics side effect
 * - P1: No rollback test
 */

import { db, analytics } from './services';

interface SignupData {
  email: string;
  name: string;
  referralCode?: string;
}

export async function createUserWithAnalytics(signupData: SignupData) {
  return db.$transaction(async (tx) => {
    // Create user
    const user = await tx.order.create({
      data: {
        email: signupData.email,
        name: signupData.name,
        type: 'USER',
      },
    });

    // ISSUE: Analytics tracked INSIDE transaction
    // If transaction rolls back, we have phantom analytics data
    await analytics.track('user.signed_up', {
      userId: user.id,
      email: signupData.email,
      hasReferral: !!signupData.referralCode,
    });

    // Create profile (could fail with constraint violation)
    await tx.order.create({
      data: {
        userId: user.id,
        type: 'PROFILE',
      },
    });

    return user;
  });
}
