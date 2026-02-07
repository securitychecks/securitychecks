// @fixture: false-positive
// @invariant: AUTHZ.SERVICE_LAYER.ENFORCED
// @expected-findings: 0
// @description: Service with proper auth checks - should NOT be flagged

import { db } from '../lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '../lib/auth';

interface ProfileData {
  name: string;
  email: string;
}

/**
 * Updates a user's profile WITH proper auth check
 * This should NOT be flagged
 */
export async function updateUserProfile(userId: string, data: ProfileData) {
  // Auth check at service layer
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  // Verify user can only update their own profile
  if (session.user.id !== userId) {
    throw new Error('Forbidden');
  }

  return db.user.update({
    where: { id: userId },
    data,
  });
}

/**
 * Gets team members WITH auth check
 * This should NOT be flagged
 */
export async function listTeamMembers(teamId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  // Check user is member of this team
  const membership = await db.teamMember.findFirst({
    where: {
      teamId,
      userId: session.user.id,
    },
  });

  if (!membership) {
    throw new Error('Forbidden');
  }

  return db.teamMember.findMany({
    where: { teamId },
    include: { user: true },
  });
}
