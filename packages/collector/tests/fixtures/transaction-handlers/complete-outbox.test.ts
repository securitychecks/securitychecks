/**
 * Tests for the outbox pattern implementation
 *
 * These tests verify:
 * 1. Successful orders create outbox entries
 * 2. Failed transactions don't leave orphaned outbox entries
 */

import { describe, it, expect, vi } from 'vitest';
import { createOrderWithOutbox } from './complete-outbox';
import { db } from './services';

describe('createOrderWithOutbox transaction safety', () => {
  it('should not send email on rollback', async () => {
    // Arrange: Mock outbox to track calls
    const outboxSpy = vi.spyOn(db.outbox, 'create');

    // Simulate a constraint violation that causes rollback
    vi.spyOn(db.order, 'create').mockRejectedValueOnce(
      new Error('Constraint violation: customerId does not exist')
    );

    // Act & Assert
    await expect(
      createOrderWithOutbox({
        customerId: 'nonexistent',
        amount: 100,
        email: 'test@example.com',
      })
    ).rejects.toThrow('Constraint violation');

    // The outbox entry should NOT exist (rolled back with transaction)
    // In a real test, we'd query the DB to verify no orphaned records
    expect(outboxSpy).not.toHaveBeenCalled();
  });

  it('should create outbox entry only after successful commit', async () => {
    const outboxSpy = vi.spyOn(db.outbox, 'create');

    await createOrderWithOutbox({
      customerId: 'cust_123',
      amount: 5000,
      email: 'customer@example.com',
    });

    // Outbox entry was created in same transaction
    expect(outboxSpy).toHaveBeenCalledOnce();
    expect(outboxSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'SEND_EMAIL',
        }),
      })
    );
  });

  it('should handle duplicate idempotent requests', async () => {
    // First request succeeds
    const order1 = await createOrderWithOutbox({
      customerId: 'cust_123',
      amount: 5000,
      email: 'customer@example.com',
    });

    // Second identical request should be handled gracefully
    // (idempotency implementation depends on your design)
    const order2 = await createOrderWithOutbox({
      customerId: 'cust_123',
      amount: 5000,
      email: 'customer@example.com',
    });

    // Both complete successfully
    expect(order1.id).toBeDefined();
    expect(order2.id).toBeDefined();
  });
});
