/**
 * Tests for Svix Webhook Handler
 *
 * This test file proves the idempotency of the Svix webhook handler.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSvixWebhook } from './svix-complete';
import { db } from './db';

// Mock the database
vi.mock('./db', () => ({
  db: {
    processedEvents: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('Svix webhook idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle duplicate webhook events idempotently', async () => {
    // Arrange: Create a webhook event
    const messageId = 'msg_test_123';
    const mockReq = createMockRequest(messageId);
    const mockRes = createMockResponse();

    // First call - not yet processed
    vi.mocked(db.processedEvents.findFirst).mockResolvedValueOnce(null);

    // Act: Process the first event
    await handleSvixWebhook(mockReq, mockRes);

    // Second call - already processed
    vi.mocked(db.processedEvents.findFirst).mockResolvedValueOnce({
      id: '1',
      eventId: messageId,
      source: 'svix',
      processedAt: new Date(),
    });

    // Act: Process the same event again (duplicate)
    await handleSvixWebhook(mockReq, mockRes);

    // Assert: Database create was only called once
    expect(db.processedEvents.create).toHaveBeenCalledTimes(1);
  });

  it('should store the svix message ID before processing', async () => {
    const messageId = 'msg_test_456';
    const mockReq = createMockRequest(messageId);
    const mockRes = createMockResponse();

    vi.mocked(db.processedEvents.findFirst).mockResolvedValue(null);
    vi.mocked(db.processedEvents.create).mockResolvedValue({
      id: '1',
      eventId: messageId,
      source: 'svix',
      eventType: 'test.event',
      processedAt: new Date(),
    });

    await handleSvixWebhook(mockReq, mockRes);

    expect(db.processedEvents.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: messageId,
        source: 'svix',
      }),
    });
  });

  it('should return early for duplicate events', async () => {
    const messageId = 'msg_already_processed';
    const mockReq = createMockRequest(messageId);
    const mockRes = createMockResponse();

    // Simulate already processed
    vi.mocked(db.processedEvents.findFirst).mockResolvedValue({
      id: '1',
      eventId: messageId,
      source: 'svix',
      processedAt: new Date(),
    });

    await handleSvixWebhook(mockReq, mockRes);

    // Should NOT create a new record
    expect(db.processedEvents.create).not.toHaveBeenCalled();
    // Should return skipped response
    expect(mockRes.lastJson).toEqual({ ok: true, skipped: true });
  });
});

function createMockRequest(messageId: string): any {
  return {
    headers: {
      'svix-id': messageId,
      'svix-timestamp': String(Date.now()),
      'svix-signature': 'v1,valid_signature',
    },
    text: async () =>
      JSON.stringify({
        eventType: 'test.event',
        data: { foo: 'bar' },
      }),
  };
}

function createMockResponse(): any {
  const res: any = {
    lastStatus: 0,
    lastJson: null,
    status(code: number) {
      res.lastStatus = code;
      return res;
    },
    send(_body: string) {
      return res;
    },
    json(body: unknown) {
      res.lastJson = body;
      return res;
    },
  };
  return res;
}
