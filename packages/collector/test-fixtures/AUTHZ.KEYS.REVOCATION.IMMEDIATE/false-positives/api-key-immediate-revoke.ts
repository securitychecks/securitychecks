// @fixture: false-positive
// @invariant: AUTHZ.KEYS.REVOCATION.IMMEDIATE
// @expected-findings: 0
// @description: API key revocation with immediate cache invalidation

import { db } from '@/lib/db';
import { cache } from '@/lib/cache';
import { hashApiKey } from '@/lib/auth';

/**
 * Revokes API key WITH immediate cache invalidation
 * This should NOT be flagged
 */
export async function revokeApiKey(keyId: string) {
  // Get key hash before revoking
  const key = await db.apiKey.findUnique({
    where: { id: keyId },
    select: { keyHash: true },
  });

  // Mark as revoked in database
  await db.apiKey.update({
    where: { id: keyId },
    data: {
      revokedAt: new Date(),
      isActive: false,
    },
  });

  // Immediately invalidate cached key validation
  await cache.del(`apikey:${key!.keyHash}`);
  await cache.del(`apikey:valid:${key!.keyHash}`);
}

/**
 * Deletes API key with full cleanup
 */
export async function deleteApiKey(keyId: string) {
  const key = await db.apiKey.findUnique({
    where: { id: keyId },
    select: { keyHash: true, userId: true },
  });

  await db.apiKey.delete({
    where: { id: keyId },
  });

  // Clear all caches
  await Promise.all([
    cache.del(`apikey:${key!.keyHash}`),
    cache.del(`apikey:valid:${key!.keyHash}`),
    cache.del(`user:${key!.userId}:apikeys`),
  ]);
}
