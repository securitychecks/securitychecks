// @fixture: true-positive
// @invariant: TESTS.NO_FALSE_CONFIDENCE
// @expected-findings: 1
// @description: Test using setTimeout/sleep - timing-dependent

import { describe, it, expect } from 'vitest';

describe('UserService', () => {
  /**
   * Test with sleep - gives false confidence
   * This should be flagged - timing-dependent tests are flaky
   */
  it('should process async operation', async () => {
    const service = new UserService();

    service.startAsyncOperation();

    // BAD: Using sleep instead of proper async handling
    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(service.isComplete).toBe(true);
  });

  /**
   * Another timing-dependent test
   */
  it('should debounce calls', async () => {
    const handler = vi.fn();
    const debounced = debounce(handler, 100);

    debounced();
    debounced();
    debounced();

    // BAD: Arbitrary sleep
    await sleep(150);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
