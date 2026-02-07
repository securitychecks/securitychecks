// @fixture: true-positive
// @invariant: AUTHZ.KEYS.REVOCATION.IMMEDIATE
// @expected-findings: 1
// @description: API key revocation without immediate cache invalidation

import { db } from '@/lib/db';

/**
 * Revokes API key WITHOUT cache invalidation
 * This should be flagged - key continues working until cache expires
 */
export async function revokeApiKey(keyId: string) {
  // Mark as revoked in database
  await db.apiKey.update({
    where: { id: keyId },
    data: {
      revokedAt: new Date(),
      isActive: false,
    },
  });

  // BUG: No cache invalidation!
  // If key validation is cached, revoked key still works
  // Example: Redis caches key -> userId mapping for 1 hour
  // Revoked key continues to authenticate requests

  // Should do:
  // await cache.del(`apikey:${keyHash}`);
}

/**
 * Deletes API key but cached validation persists
 */
export async function deleteApiKey(keyId: string) {
  const key = await db.apiKey.delete({
    where: { id: keyId },
  });

  // BUG: Cached key validation not cleared
  // Key was cached as "valid" - still works until TTL expires
}
