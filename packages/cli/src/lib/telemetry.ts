/**
 * Anonymous Telemetry
 *
 * Reports aggregate scan statistics to the SecurityChecks SaaS.
 * NO source code, NO file paths, NO PII - just patterns and numbers.
 *
 * This data powers:
 * - Framework-specific calibration
 * - Pattern effectiveness tracking
 * - Invariant impact analysis
 */

import { randomUUID } from 'crypto';
import type { AuditResult } from '@securitychecks/collector';
import type { CorrelationResult } from './correlation.js';
import { isValidWaiverReasonKey } from '../baseline/index.js';
import type { CategorizationResult } from '../baseline/index.js';

// Default endpoint
const DEFAULT_ENDPOINT = 'https://api.securitychecks.ai/v1/telemetry';

export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  timeout?: number;
}

export interface ScanTelemetry {
  scanId: string;
  codebase: {
    filesScanned: number;
    servicesCount: number;
    linesOfCode?: number;
  };
  frameworks: string[];
  findings: {
    byInvariant: Record<string, number>;
    byPriority: { P0: number; P1: number; P2: number };
    total: number;
  };
  correlation?: {
    groups: number;
    escalations: number;
    correlatedFindings: number;
  };
  calibration?: {
    calibrated: number;
    suppressed: number;
  };
  patterns?: {
    applied: number;
    findings: number;
  };
  meta: {
    duration?: number;
    clientVersion: string;
    mode?: 'ci' | 'manual' | 'watch';
    ciProvider?: string;
  };
  baseline?: {
    size: number;
    waivers: number;
    newFindings: number;
  };
  feedback?: {
    waivedCount: number;
    waiverReasons: Record<string, number>;
    baselinedCount: number;
  };
}

/**
 * Build telemetry data from scan results
 */
export function buildTelemetry(
  result: AuditResult,
  options: {
    filesScanned: number;
    frameworks: string[];
    correlation?: CorrelationResult;
    categorization?: CategorizationResult;
    calibratedCount?: number;
    suppressedCount?: number;
    patternsApplied?: number;
    patternFindings?: number;
    mode?: 'ci' | 'manual' | 'watch';
    baselineSize?: number;
    waiversCount?: number;
  }
): ScanTelemetry {
  // Count findings by invariant
  const byInvariant: Record<string, number> = {};
  for (const checkResult of result.results) {
    byInvariant[checkResult.invariantId] = checkResult.findings.length;
  }

  // Detect CI provider from environment
  const ciProvider = detectCIProvider();

  return {
    scanId: randomUUID(),
    codebase: {
      filesScanned: options.filesScanned,
      servicesCount: result.artifact.services.length,
    },
    frameworks: options.frameworks,
    findings: {
      byInvariant,
      byPriority: result.summary.byPriority,
      total: result.summary.byPriority.P0 + result.summary.byPriority.P1 + result.summary.byPriority.P2,
    },
    correlation: options.correlation ? {
      groups: options.correlation.stats.correlationGroups,
      escalations: options.correlation.stats.severityEscalations,
      correlatedFindings: options.correlation.stats.correlatedFindings,
    } : undefined,
    calibration: (options.calibratedCount !== undefined) ? {
      calibrated: options.calibratedCount,
      suppressed: options.suppressedCount ?? 0,
    } : undefined,
    patterns: (options.patternsApplied !== undefined) ? {
      applied: options.patternsApplied,
      findings: options.patternFindings ?? 0,
    } : undefined,
    meta: {
      duration: result.duration,
      clientVersion: process.env['CLI_VERSION'] ?? '0.0.0',
      mode: options.mode ?? (ciProvider ? 'ci' : 'manual'),
      ciProvider,
    },
    baseline: (options.categorization) ? {
      size: options.baselineSize ?? 0,
      waivers: options.waiversCount ?? 0,
      newFindings: options.categorization.counts.new,
    } : undefined,
    feedback: (options.categorization) ? {
      waivedCount: options.categorization.counts.waived,
      waiverReasons: buildWaiverReasonCounts(options.categorization),
      baselinedCount: options.categorization.counts.baselined,
    } : undefined,
  };
}

/**
 * Report telemetry to the SaaS
 */
export async function reportTelemetry(
  telemetry: ScanTelemetry,
  config: TelemetryConfig
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
          'X-Client-Version': telemetry.meta.clientVersion,
        },
        body: JSON.stringify(telemetry),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // Telemetry failures are silent
    return false;
  }
}

/**
 * Build waiver reason distribution from categorization result
 */
function buildWaiverReasonCounts(categorization: CategorizationResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of categorization.waived) {
    const waiver = finding.waiver;
    if (!waiver) continue;
    const candidate = waiver.reasonKey ?? waiver.reason;
    const key = candidate && isValidWaiverReasonKey(candidate) ? candidate : 'other';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Detect CI provider from environment variables
 */
function detectCIProvider(): string | undefined {
  if (process.env['GITHUB_ACTIONS']) return 'github';
  if (process.env['GITLAB_CI']) return 'gitlab';
  if (process.env['JENKINS_URL']) return 'jenkins';
  if (process.env['CIRCLECI']) return 'circleci';
  if (process.env['TRAVIS']) return 'travis';
  if (process.env['BITBUCKET_BUILD_NUMBER']) return 'bitbucket';
  if (process.env['AZURE_PIPELINES']) return 'azure';
  if (process.env['CI']) return 'unknown';
  return undefined;
}

/**
 * Check if telemetry is opt-out
 */
export function isTelemetryDisabled(): boolean {
  return (
    process.env['SECURITYCHECKS_TELEMETRY'] === 'false' ||
    process.env['DO_NOT_TRACK'] === '1'
  );
}

export default reportTelemetry;
