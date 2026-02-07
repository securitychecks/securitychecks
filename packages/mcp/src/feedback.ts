export type FeedbackVerdict = 'true_positive' | 'false_positive';

export interface FeedbackToolArgs {
  invariant_id?: string;
  verdict?: string;
  reason?: string;
}

export interface FeedbackToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// Keep tool responses aligned with the MCP SDK result types.
// (Our response object is a valid CallToolResult / CompatibilityCallToolResult.)
export type McpToolResult = import('@modelcontextprotocol/sdk/types.js').CompatibilityCallToolResult;

export async function handleFeedbackTool(
  args: FeedbackToolArgs | undefined,
  options?: {
    cwd?: string;
    now?: () => Date;
    fetchFn?: typeof fetch;
  }
): Promise<McpToolResult> {
  const invariantId = args?.invariant_id;
  const verdict = args?.verdict as FeedbackVerdict | undefined;
  const reason = args?.reason;

  if (!invariantId || !verdict) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: invariant_id and verdict are required.',
        },
      ],
      isError: true,
    };
  }

  if (!['true_positive', 'false_positive'].includes(verdict)) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: verdict must be "true_positive" or "false_positive", got "${verdict}"`,
        },
      ],
      isError: true,
    };
  }

  try {
    const { writeFileSync, readFileSync, existsSync, mkdirSync } = await import('fs');
    const { join } = await import('path');
    const cwd = options?.cwd ?? process.cwd();
    const feedbackDir = join(cwd, '.scheck');
    const feedbackFile = join(feedbackDir, 'feedback.json');
    const now = options?.now ?? (() => new Date());

    if (!existsSync(feedbackDir)) {
      mkdirSync(feedbackDir, { recursive: true });
    }

    let feedbackData: Array<{
      invariantId: string;
      verdict: string;
      reason?: string;
      timestamp: string;
    }> = [];
    if (existsSync(feedbackFile)) {
      try {
        feedbackData = JSON.parse(readFileSync(feedbackFile, 'utf-8'));
      } catch {
        feedbackData = [];
      }
    }

    feedbackData.push({
      invariantId,
      verdict,
      reason,
      timestamp: now().toISOString(),
    });

    writeFileSync(feedbackFile, JSON.stringify(feedbackData, null, 2));

    try {
      const clientVersion = process.env['MCP_VERSION'] ?? '0.0.0-dev';
      const endpoint = 'https://api.securitychecks.ai/v1/feedback';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const fetchFn = options?.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
      if (fetchFn) {
        fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invariantId, verdict, reason, clientVersion }),
          signal: controller.signal,
        })
          .catch(() => {})
          .finally(() => clearTimeout(timeoutId));
      } else {
        clearTimeout(timeoutId);
      }
    } catch {
      // Silent failure for API reporting
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              recorded: true,
              invariantId,
              verdict,
              reason: reason ?? null,
              storedLocally: true,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error recording feedback: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
