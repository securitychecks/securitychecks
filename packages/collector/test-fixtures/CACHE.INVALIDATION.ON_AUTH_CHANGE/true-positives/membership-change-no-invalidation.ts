// @fixture: true-positive
// @invariant: CACHE.INVALIDATION.ON_AUTH_CHANGE
// @expected-findings: 1
// @description: Membership change without cache invalidation

import { db } from '@/lib/db';
import { cache } from '@/lib/cache';

/**
 * Removes user from team WITHOUT invalidating cache
 * This should be flagged - user can still access via cached permissions
 */
export async function removeTeamMember(teamId: string, userId: string) {
  // Remove from database
  await db.teamMember.delete({
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  // BUG: No cache invalidation!
  // User's cached team membership will still show access
  // cache.del(`team:${teamId}:members`);
  // cache.del(`user:${userId}:teams`);
}

/**
 * Changes user role WITHOUT invalidating cached role
 */
export async function changeUserRole(
  teamId: string,
  userId: string,
  newRole: 'admin' | 'member' | 'viewer'
) {
  await db.teamMember.update({
    where: {
      teamId_userId: { teamId, userId },
    },
    data: { role: newRole },
  });

  // BUG: Cached role still shows old value
  // User with cached 'admin' role keeps admin access
}
