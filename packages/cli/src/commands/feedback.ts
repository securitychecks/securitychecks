/**
 * Feedback Command
 *
 * Report whether a finding was a true positive or false positive.
 * Improves pattern accuracy over time.
 *
 * Usage:
 *   scheck feedback AUTHZ.SERVICE_LAYER.ENFORCED --verdict fp --reason not_applicable
 *   scheck feedback WEBHOOK.IDEMPOTENT --verdict tp
 */

import pc from 'picocolors';
import {
  reportFeedback,
  isValidReason,
  VALID_REASONS,
  buildFeedbackEndpoint,
  type FeedbackConfig,
  type FeedbackReason,
} from '../lib/feedback.js';
import { isTelemetryDisabled } from '../lib/telemetry.js';
import { getApiUrl, loadCloudConfig } from '../lib/cloud-config.js';

export interface FeedbackOptions {
  path?: string;
  verdict: string;
  reason?: string;
  endpoint?: string;
}

const VERDICT_MAP: Record<string, 'true_positive' | 'false_positive'> = {
  tp: 'true_positive',
  true_positive: 'true_positive',
  fp: 'false_positive',
  false_positive: 'false_positive',
};

export async function feedbackCommand(
  invariantIdOrFindingId: string,
  options: FeedbackOptions
): Promise<void> {
  // Validate verdict
  const verdict = VERDICT_MAP[options.verdict];
  if (!verdict) {
    console.error(pc.red(`Error: Invalid verdict "${options.verdict}"`));
    console.log(pc.dim('Valid values: tp, fp, true_positive, false_positive'));
    process.exit(1);
  }

  // Validate reason if provided
  if (options.reason && !isValidReason(options.reason)) {
    console.error(pc.red(`Error: Invalid reason "${options.reason}"`));
    console.log(pc.dim(`Valid reasons: ${VALID_REASONS.join(', ')}`));
    process.exit(1);
  }

  const reason = options.reason as FeedbackReason | undefined;

  // Extract invariant ID (strip hash suffix if present)
  const invariantId = invariantIdOrFindingId.includes(':')
    ? invariantIdOrFindingId.split(':').slice(0, -1).join(':')
    : invariantIdOrFindingId;

  // Check telemetry opt-out
  if (isTelemetryDisabled()) {
    console.log(pc.yellow('Telemetry is disabled. Feedback will not be sent.'));
    console.log(pc.dim('Unset SECURITYCHECKS_TELEMETRY=false or DO_NOT_TRACK=1 to enable.'));
    return;
  }

  // Build config from cloud settings
  const cloudConfig = await loadCloudConfig();
  const endpointOverride =
    options.endpoint || process.env['SECURITYCHECKS_FEEDBACK_URL'];
  let endpoint = endpointOverride;
  if (!endpoint) {
    try {
      endpoint = buildFeedbackEndpoint(getApiUrl(cloudConfig));
    } catch {
      endpoint = undefined;
    }
  }
  const feedbackConfig: FeedbackConfig = {
    enabled: true,
    apiKey: cloudConfig.apiKey ?? undefined,
    endpoint,
    timeout: 5000,
  };

  const clientVersion = process.env['CLI_VERSION'] ?? '0.0.0-dev';

  console.log(pc.dim('Sending feedback...'));

  const success = await reportFeedback(
    {
      invariantId,
      verdict,
      reason,
      clientVersion,
    },
    feedbackConfig
  );

  if (success) {
    const verdictLabel = verdict === 'true_positive' ? pc.green('true positive') : pc.red('false positive');
    console.log(pc.green('✓ Feedback recorded'));
    console.log(`  ${pc.dim('Invariant:')} ${invariantId}`);
    console.log(`  ${pc.dim('Verdict:')}   ${verdictLabel}`);
    if (reason) {
      console.log(`  ${pc.dim('Reason:')}    ${reason}`);
    }
  } else {
    console.error(pc.red('Failed to send feedback. The API may be unreachable.'));
    process.exit(1);
  }
}
