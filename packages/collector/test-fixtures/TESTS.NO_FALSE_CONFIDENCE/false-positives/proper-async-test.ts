// @fixture: false-positive
// @invariant: TESTS.NO_FALSE_CONFIDENCE
// @expected-findings: 0
// @description: Properly written async tests

import { describe, it, expect, vi } from 'vitest';

describe('UserService', () => {
  /**
   * Proper async test using waitFor
   * This should NOT be flagged
   */
  it('should process async operation', async () => {
    const service = new UserService();

    const result = await service.processAsync();

    expect(result.status).toBe('complete');
    expect(result.data).toEqual({ processed: true });
  });

  /**
   * Using fake timers instead of real sleep
   */
  it('should debounce calls', async () => {
    vi.useFakeTimers();

    const handler = vi.fn();
    const debounced = debounce(handler, 100);

    debounced();
    debounced();
    debounced();

    // GOOD: Using fake timers
    await vi.advanceTimersByTimeAsync(150);

    expect(handler).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  /**
   * Specific assertions
   */
  it('should create user with correct data', async () => {
    const response = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });

    // GOOD: Specific status code
    expect(response.status).toBe(201);

    const user = await response.json();
    // GOOD: Specific shape assertions
    expect(user).toMatchObject({
      id: expect.any(String),
      name: 'Test',
      createdAt: expect.any(String),
    });
  });
});
