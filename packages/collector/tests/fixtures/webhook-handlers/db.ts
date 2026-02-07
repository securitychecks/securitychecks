/**
 * Mock database for webhook fixtures
 */

export const db = {
  processedEvents: {
    findFirst: async (_query: { where: { eventId: string; source: string } }) => null,
    create: async (_data: { data: { eventId: string; source: string; eventType?: string; processedAt: Date } }) => ({
      id: '1',
      ..._data.data,
    }),
    findMany: async (_query?: unknown) => [],
  },
};
