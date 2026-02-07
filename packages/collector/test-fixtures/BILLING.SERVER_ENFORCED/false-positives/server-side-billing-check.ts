// @fixture: false-positive
// @invariant: BILLING.SERVER_ENFORCED
// @expected-findings: 0
// @description: Proper server-side billing enforcement

import { db } from '@/lib/db';
import { getBillingLimits, BillingError } from '@/lib/billing';

/**
 * Creates project WITH server-side billing check
 * This should NOT be flagged
 */
export async function createProject(userId: string, data: ProjectData) {
  // Check billing limits server-side
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { subscription: true, projects: true },
  });

  const limits = getBillingLimits(user!.subscription?.plan ?? 'free');

  if (user!.projects.length >= limits.maxProjects) {
    throw new BillingError(
      'PROJECT_LIMIT_REACHED',
      `Your plan allows ${limits.maxProjects} projects. Please upgrade to create more.`
    );
  }

  const project = await db.project.create({
    data: {
      ...data,
      ownerId: userId,
    },
  });

  return project;
}

/**
 * API endpoint WITH entitlement check
 */
export async function addTeamMember(teamId: string, email: string) {
  const team = await db.team.findUnique({
    where: { id: teamId },
    include: { subscription: true, members: true },
  });

  const limits = getBillingLimits(team!.subscription?.plan ?? 'free');

  if (team!.members.length >= limits.maxTeamMembers) {
    throw new BillingError(
      'MEMBER_LIMIT_REACHED',
      `Your plan allows ${limits.maxTeamMembers} team members. Please upgrade.`
    );
  }

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
