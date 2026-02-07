// @fixture: true-positive
// @invariant: AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE
// @expected-findings: 1
// @description: Membership revocation without immediate cache invalidation

import { db } from '@/lib/db';

/**
 * Revokes team membership WITHOUT clearing session/cache
 * This should be flagged - user retains access until cache expires
 */
export async function removeFromTeam(teamId: string, userId: string) {
  // Delete membership from database
  await db.teamMember.delete({
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  // BUG: No session invalidation!
  // User's active session still has team access
  // No cache clear - cached permissions still valid

  // Should do:
  // await invalidateUserSessions(userId);
  // await cache.del(`user:${userId}:teams`);
}

/**
 * Downgrades role but cached role persists
 */
export async function downgradeToViewer(teamId: string, userId: string) {
  await db.teamMember.update({
    where: {
      teamId_userId: { teamId, userId },
    },
    data: { role: 'viewer' },
  });

  // BUG: User's cached 'admin' role persists
  // They can still perform admin actions until cache expires
}
