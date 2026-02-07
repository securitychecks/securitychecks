// @fixture: false-positive
// @invariant: CACHE.INVALIDATION.ON_AUTH_CHANGE
// @expected-findings: 0
// @description: Membership change WITH proper cache invalidation

import { db } from '@/lib/db';
import { cache } from '@/lib/cache';

/**
 * Removes user from team WITH cache invalidation
 * This should NOT be flagged
 */
export async function removeTeamMember(teamId: string, userId: string) {
  // Remove from database
  await db.teamMember.delete({
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  // Invalidate all relevant caches
  await Promise.all([
    cache.del(`team:${teamId}:members`),
    cache.del(`user:${userId}:teams`),
    cache.del(`user:${userId}:permissions:${teamId}`),
  ]);
}

/**
 * Changes user role WITH cache invalidation
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

  // Invalidate cached role
  await cache.del(`user:${userId}:role:${teamId}`);
  await cache.del(`user:${userId}:permissions:${teamId}`);
}
