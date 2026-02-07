import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportFeedback, buildFeedbackEndpoint } from './feedback.js';

describe('reportFeedback', () => {
  const payload = {
    invariantId: 'INV.A',
    verdict: 'true_positive' as const,
    clientVersion: '1.2.3',
  };

  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true without calling fetch when disabled', async () => {
    const result = await reportFeedback(payload, { enabled: false });

    expect(result).toBe(true);
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('posts payload with headers and returns response status', async () => {
    const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true });

    const result = await reportFeedback(payload, {
      enabled: true,
      endpoint: 'https://example.com/feedback',
      apiKey: 'api-key-123',
      timeout: 2000,
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/feedback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer api-key-123',
          'X-Client-Version': '1.2.3',
        }),
        body: JSON.stringify(payload),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('includes Vercel bypass header when configured', async () => {
    const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true });

    process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] = 'bypass-secret';
    const result = await reportFeedback(payload, {
      enabled: true,
      endpoint: 'https://example.com/feedback',
    });
    delete process.env['VERCEL_AUTOMATION_BYPASS_SECRET'];

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/feedback',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-vercel-protection-bypass': 'bypass-secret',
        }),
      })
    );
  });

  it('returns false when the request times out', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockImplementation((_url: string, options: any) => {
      return new Promise((_resolve, reject) => {
        const signal = options?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }
      });
    });
    (globalThis as any).fetch = fetchMock;

    const promise = reportFeedback(payload, { enabled: true, timeout: 10 });

    vi.advanceTimersByTime(20);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(false);
  });
});

describe('buildFeedbackEndpoint', () => {
  it('uses /v1/feedback for api hosts', () => {
    expect(buildFeedbackEndpoint('https://api.securitychecks.ai')).toBe(
      'https://api.securitychecks.ai/v1/feedback'
    );
  });

  it('uses /api/v1/feedback for app hosts', () => {
    expect(buildFeedbackEndpoint('https://securitychecks-git-preview-codewheel.vercel.app')).toBe(
      'https://securitychecks-git-preview-codewheel.vercel.app/api/v1/feedback'
    );
  });
});
