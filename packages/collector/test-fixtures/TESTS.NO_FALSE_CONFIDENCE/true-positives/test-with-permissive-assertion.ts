// @fixture: true-positive
// @invariant: TESTS.NO_FALSE_CONFIDENCE
// @expected-findings: 1
// @description: Test with overly permissive assertions

import { describe, it, expect } from 'vitest';

describe('API endpoints', () => {
  /**
   * Permissive status code check - gives false confidence
   * This should be flagged - accepts multiple success codes
   */
  it('should create resource', async () => {
    const response = await fetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });

    // BAD: Permissive assertion - 200 OR 201 OR 204
    expect([200, 201, 204]).toContain(response.status);
  });

  /**
   * Truthy check instead of specific assertion
   */
  it('should return user data', async () => {
    const user = await getUser('123');

    // BAD: Only checks truthy, not actual shape
    expect(user).toBeTruthy();
    expect(user.name).toBeTruthy();
  });

  /**
   * toBeGreaterThan(0) when expecting specific count
   */
  it('should return results', async () => {
    const results = await search('test');

    // BAD: Should check specific count or at least validate items
    expect(results.length).toBeGreaterThan(0);
  });
});
