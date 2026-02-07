// @fixture: true-positive
// @invariant: AUTHZ.SERVICE_LAYER.ENFORCED
// @expected-findings: 1
// @description: Service function mutates user data without any auth check

import { db } from '../lib/db';

interface ProfileData {
  name: string;
  email: string;
}

/**
 * Updates a user's profile - NO AUTH CHECK
 * This should be flagged because it's a data mutation without authorization
 */
export async function updateUserProfile(userId: string, data: ProfileData) {
  // Direct database mutation without checking if caller is authorized
  return db.user.update({
    where: { id: userId },
    data,
  });
}

/**
 * Deletes a user account - NO AUTH CHECK
 * This should be flagged
 */
export async function deleteUser(userId: string) {
  return db.user.delete({
    where: { id: userId },
  });
}

/**
 * Gets all users for a team - NO AUTH CHECK
 * This should be flagged because it accesses team data
 */
export async function listTeamMembers(teamId: string) {
  return db.teamMember.findMany({
    where: { teamId },
    include: { user: true },
  });
}
