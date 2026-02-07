import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleFeedbackTool } from './feedback.js';

function getFirstTextContent(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return '';
  const first = content[0] as unknown;
  if (!first || typeof first !== 'object') return '';
  const maybeText = (first as { text?: unknown }).text;
  return typeof maybeText === 'string' ? maybeText : '';
}

describe('handleFeedbackTool', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'scheck-mcp-feedback-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes feedback locally and returns JSON response', async () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });

    const result = await handleFeedbackTool(
      { invariant_id: 'WEBHOOK.IDEMPOTENT', verdict: 'false_positive', reason: 'not_applicable' },
      { cwd: tempDir, now: () => now, fetchFn: fetchFn as unknown as typeof fetch }
    );

    const feedbackFile = join(tempDir, '.scheck', 'feedback.json');
    const data = JSON.parse(readFileSync(feedbackFile, 'utf-8'));

    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({
      invariantId: 'WEBHOOK.IDEMPOTENT',
      verdict: 'false_positive',
      reason: 'not_applicable',
      timestamp: now.toISOString(),
    });

    const responseText = getFirstTextContent(result);
    const parsed = JSON.parse(responseText);

    expect(parsed).toMatchObject({
      recorded: true,
      invariantId: 'WEBHOOK.IDEMPOTENT',
      verdict: 'false_positive',
      reason: 'not_applicable',
      storedLocally: true,
    });
  });
});
