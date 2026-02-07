/**
 * Finding Feedback Client
 *
 * Reports finding quality feedback (TP/FP verdicts) to the SecurityChecks SaaS.
 * Privacy-preserving: sends only invariantId + verdict + predefined reason enum.
 * No source code, no file paths, no PII.
 */

const DEFAULT_ENDPOINT = 'https://api.securitychecks.ai/v1/feedback';

export function buildFeedbackEndpoint(apiBaseUrl: string): string {
  const base = apiBaseUrl.trim().replace(/\/$/, '');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return `${base}/v1/feedback`;
  }

  const host = url.hostname.toLowerCase();
  const isApiHost = host.startsWith('api.') || host === 'api.securitychecks.ai';
  const suffix = isApiHost ? '/v1/feedback' : '/api/v1/feedback';

  const basePath = url.pathname.replace(/\/$/, '');
  url.pathname = `${basePath}${suffix}`;
  return url.toString();
}

export interface FeedbackPayload {
  invariantId: string;
  verdict: 'true_positive' | 'false_positive';
  reason?: 'not_applicable' | 'acceptable_risk' | 'wrong_location' | 'outdated_pattern' | 'missing_context';
  framework?: string;
  clientVersion: string;
}

export interface FeedbackConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  timeout?: number;
}

/**
 * Report finding feedback to the SaaS
 *
 * Follows the same fire-and-forget pattern as correlation-telemetry.ts:
 * AbortController with timeout, silent failures.
 */
export async function reportFeedback(
  payload: FeedbackPayload,
  config: FeedbackConfig
): Promise<boolean> {
  if (!config.enabled) {
    return true;
  }

  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const timeout = config.timeout ?? 5000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
          ...(process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] && {
            'x-vercel-protection-bypass': process.env['VERCEL_AUTOMATION_BYPASS_SECRET'],
          }),
          'X-Client-Version': payload.clientVersion,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // Feedback failures are silent - shouldn't break CLI
    return false;
  }
}

export const VALID_REASONS = [
  'not_applicable',
  'acceptable_risk',
  'wrong_location',
  'outdated_pattern',
  'missing_context',
] as const;

export type FeedbackReason = (typeof VALID_REASONS)[number];

export function isValidReason(reason: string): reason is FeedbackReason {
  return (VALID_REASONS as readonly string[]).includes(reason);
}
