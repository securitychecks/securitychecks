/**
 * Correlation Telemetry
 *
 * Reports correlation data to the SecurityChecks SaaS.
 * This builds the data moat around which invariant combinations
 * actually compound risk in production codebases.
 */

import type { CorrelationResult, CorrelatedFinding } from './correlation.js';
import { randomUUID } from 'crypto';

// Default endpoint (can be overridden)
const DEFAULT_ENDPOINT = 'https://api.securitychecks.ai/v1/correlations';

export interface CorrelationTelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  timeout?: number;
}

interface CorrelationObservation {
  invariants: string[];
  context: {
    framework?: string;
    file?: string;
    functionName?: string;
    route?: string;
  };
  stats: {
    findingCount: number;
    severityBefore?: 'P0' | 'P1' | 'P2';
    severityAfter?: 'P0' | 'P1' | 'P2';
    wasEscalated: boolean;
    riskMultiplier?: number;
  };
  attackPath?: {
    title: string;
    exploitability: 'easy' | 'medium' | 'hard';
    impact: 'low' | 'medium' | 'high' | 'critical';
    timeWindow?: string;
    steps: Array<{
      step: number;
      description: string;
      invariantId: string;
      location?: { file: string; line: number };
    }>;
  };
  compoundingEffect?: {
    description: string;
    signals: string[];
  };
  meta: {
    clientVersion: string;
    requestId: string;
    timestamp: string;
  };
}

/**
 * Convert CorrelatedFinding to observation format for API
 */
function toObservation(
  correlation: CorrelatedFinding,
  framework?: string
): CorrelationObservation {
  const allFindings = [correlation.primary, ...correlation.related];
  const invariants = [...new Set(allFindings.map(f => f.invariantId))];

  return {
    invariants,
    context: {
      framework,
      file: correlation.sharedContext.file,
      functionName: correlation.sharedContext.functionName,
      route: correlation.sharedContext.route,
    },
    stats: {
      findingCount: correlation.sharedContext.findingCount,
      severityBefore: correlation.primary.severity,
      severityAfter: correlation.adjustedSeverity,
      wasEscalated: correlation.adjustedSeverity !== correlation.primary.severity,
      riskMultiplier: correlation.compoundingEffect.riskMultiplier,
    },
    attackPath: correlation.attackPath ? {
      title: correlation.attackPath.title,
      exploitability: correlation.attackPath.exploitability,
      impact: correlation.attackPath.impact,
      timeWindow: correlation.attackPath.timeWindow,
      steps: correlation.attackPath.steps,
    } : undefined,
    compoundingEffect: {
      description: correlation.compoundingEffect.description,
      signals: correlation.compoundingEffect.signals,
    },
    meta: {
      clientVersion: process.env['CLI_VERSION'] ?? '0.0.0',
      requestId: randomUUID(),
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Report correlation results to the SaaS
 */
export async function reportCorrelations(
  result: CorrelationResult,
  config: CorrelationTelemetryConfig,
  framework?: string
): Promise<{ success: boolean; stored?: number; errors?: number }> {
  if (!config.enabled || result.correlations.length === 0) {
    return { success: true, stored: 0 };
  }

  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const timeout = config.timeout ?? 5000;

  try {
    const observations = result.correlations.map(c => toObservation(c, framework));

    const payload = {
      correlations: observations,
      summary: result.stats,
      meta: {
        clientVersion: process.env['CLI_VERSION'] ?? '0.0.0',
        framework,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
          'X-Client-Version': process.env['CLI_VERSION'] ?? '0.0.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { success: false };
      }

      const data = await response.json() as { stored?: number; errors?: number };
      return {
        success: true,
        stored: data.stored ?? observations.length,
        errors: data.errors ?? 0,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    // Telemetry failures shouldn't break the CLI
    return { success: false };
  }
}

/**
 * Report feedback on a correlation (user marking as accurate/inaccurate)
 */
export async function reportCorrelationFeedback(
  requestId: string,
  wasAccurate: boolean,
  reason?: string,
  config?: CorrelationTelemetryConfig
): Promise<boolean> {
  const endpoint = config?.endpoint ?? DEFAULT_ENDPOINT;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(config?.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        requestId,
        wasAccurate,
        feedbackReason: reason,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export default reportCorrelations;
