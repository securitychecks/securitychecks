/**
 * Test fixture for AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE checker
 */

import { db } from './db';
import { cache } from './cache';

// BAD: No cache invalidation on member removal
export async function removeMember(userId: string, teamId: string) {
  await db.teamMember.delete({
    where: { userId_teamId: { userId, teamId } },
  });
  // Missing: cache.del(`membership:${userId}:${teamId}`);
}

// BAD: No cache invalidation on role downgrade
export async function downgradeRole(userId: string, teamId: string, newRole: string) {
  await db.teamMember.update({
    where: { userId_teamId: { userId, teamId } },
    data: { role: newRole },
  });
  // Missing: cache invalidation
}

// GOOD: Has cache invalidation
export async function removeFromTeam(userId: string, teamId: string) {
  await db.teamMember.delete({
    where: { userId_teamId: { userId, teamId } },
  });

  // Cache invalidation present
  await cache.del(`membership:${userId}:${teamId}`);
  await cache.del(`user:${userId}:teams`);
}

// API Key revocation - BAD: no cache invalidation
export async function revokeApiKey(keyId: string) {
  await db.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
  // Missing: cache.del(`apikey:${keyId}`);
}

// API Key revocation - GOOD: has cache invalidation
export async function deleteApiKey(keyId: string, hashedSecret: string) {
  await db.apiKey.delete({
    where: { id: keyId },
  });

  // Cache invalidation present
  await cache.del(`apikey:${hashedSecret}`);
}
