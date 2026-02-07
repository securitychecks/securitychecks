// @fixture: true-positive
// @invariant: BILLING.SERVER_ENFORCED
// @expected-findings: 1
// @description: Billing limit only checked on client side

import { db } from '@/lib/db';

/**
 * Creates project without server-side billing check
 * This should be flagged - client check can be bypassed
 */
export async function createProject(userId: string, data: ProjectData) {
  // No server-side billing check!
  // Client might show "limit reached" but API doesn't enforce

  const project = await db.project.create({
    data: {
      ...data,
      ownerId: userId,
    },
  });

  return project;
}

/**
 * API endpoint without entitlement check
 */
export async function addTeamMember(teamId: string, email: string) {
  // Should check: is team on a plan that allows more members?
  // But we don't - anyone can add unlimited members via API

  const user = await db.user.findUnique({ where: { email } });

  await db.teamMember.create({
    data: {
      teamId,
      userId: user!.id,
      role: 'member',
    },
  });
}

interface ProjectData {
  name: string;
  description?: string;
}
