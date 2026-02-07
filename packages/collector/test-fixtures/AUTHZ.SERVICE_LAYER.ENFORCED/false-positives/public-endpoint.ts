// @fixture: false-positive
// @invariant: AUTHZ.SERVICE_LAYER.ENFORCED
// @expected-findings: 0
// @description: Intentionally public endpoints - should NOT be flagged

import { db } from '../lib/db';

/**
 * Health check endpoint - intentionally public
 * This should NOT be flagged
 */
export async function healthCheck() {
  const dbHealth = await db.$queryRaw`SELECT 1`;
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Public blog posts list - intentionally public
 * This should NOT be flagged (no user-specific data)
 */
export async function getPublicPosts() {
  return db.post.findMany({
    where: { published: true },
    select: {
      id: true,
      title: true,
      excerpt: true,
      publishedAt: true,
    },
  });
}

/**
 * Public product catalog - intentionally public
 */
export async function getProducts() {
  return db.product.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      price: true,
      description: true,
    },
  });
}
