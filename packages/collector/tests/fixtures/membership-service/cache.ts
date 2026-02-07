/**
 * Mock cache client
 */
export const cache = {
  get: async (key: string) => null,
  set: async (key: string, value: any, ttl?: number) => {},
  del: async (key: string) => {},
};

// Simulate auth cache reads (triggers checker)
export async function getMembership(userId: string, teamId: string) {
  const cached = await cache.get(`membership:${userId}:${teamId}`);
  if (cached) return cached;
  // Fetch from DB and cache
  return null;
}

export async function validateApiKey(hashedSecret: string) {
  const cached = await cache.get(`apikey:${hashedSecret}`);
  if (cached) return cached;
  return null;
}
