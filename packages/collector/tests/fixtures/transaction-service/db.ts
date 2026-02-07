/**
 * Mock Prisma client
 */
export const prisma = {
  $transaction: async <T>(fn: (tx: any) => Promise<T>) => fn({}),
};
