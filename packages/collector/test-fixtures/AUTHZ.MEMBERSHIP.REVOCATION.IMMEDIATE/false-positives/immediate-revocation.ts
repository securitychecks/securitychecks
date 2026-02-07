// @fixture: false-positive
// @invariant: AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE
// @expected-findings: 0
// @description: Immediate membership revocation with cache invalidation

import { db } from '@/lib/db';
import { cache } from '@/lib/cache';
import { invalidateUserSessions } from '@/lib/auth';

/**
 * Revokes team membership WITH immediate invalidation
 * This should NOT be flagged
 */
export async function removeFromTeam(teamId: string, userId: string) {
  // Delete membership from database
  await db.teamMember.delete({
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  // Immediately invalidate all cached data
  await Promise.all([
    // Clear permission cache
    cache.del(`user:${userId}:teams`),
    cache.del(`user:${userId}:permissions:${teamId}`),
    cache.del(`team:${teamId}:members`),
    // Invalidate active sessions
    invalidateUserSessions(userId),
  ]);
}

/**
 * Role downgrade with immediate effect
 */
export async function downgradeToViewer(teamId: string, userId: string) {
  await db.teamMember.update({
    where: {
      teamId_userId: { teamId, userId },
    },
    data: { role: 'viewer' },
  });

  // Immediately clear cached role
  await cache.del(`user:${userId}:role:${teamId}`);
  await cache.del(`user:${userId}:permissions:${teamId}`);

  // Force re-auth on next request
  await invalidateUserSessions(userId);
}
