/**
 * Mock services for transaction fixtures
 */

export const emailService = {
  send: async (_options: { to: string; subject: string; body: string }) => {
    console.log('Sending email...');
  },
};

export const webhookService = {
  send: async (_url: string, _payload: unknown) => {
    console.log('Calling webhook...');
  },
};

export const analytics = {
  track: async (_event: string, _properties: Record<string, unknown>) => {
    console.log('Tracking event...');
  },
};

export const db = {
  $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => {
    return fn(db);
  },
  order: {
    create: async (data: { data: unknown }) => ({ id: '1', ...data.data }),
  },
  outbox: {
    create: async (data: { data: unknown }) => ({ id: '1', ...data.data }),
  },
  processedEmails: {
    findFirst: async (_query: unknown) => null,
    create: async (_data: unknown) => ({}),
  },
};
