/**
 * Audit API - Programmatic interface for running the staff check
 *
 * This module provides the core audit functionality that can be used by:
 * - CLI commands
 * - MCP server
 * - Programmatic integration
 *
 * SECURITY NOTE: All audit functions require cloud API authentication.
 * Detection logic runs server-side to protect IP.
 * See: docs/POST_MORTEM_001_ENGINE_EXPOSURE.md
 */

import {
  collect,
  loadConfig,
  resolveTargetPath,
  type AuditResult,
  type CollectorArtifact,
  type Artifact,
} from '@securitychecks/collector';
import { getCloudApiKey, getCloudApiBaseUrl } from './lib/license.js';
import { evaluateCloud } from './lib/cloud-eval.js';
import { CLIError, ErrorCodes } from './lib/errors.js';

// NOTE: Engine import removed - detection runs server-side only
// import { runAllCheckers } from '@securitychecks/engine';

export interface AuditOptions {
  /** Target path to audit (default: current directory) */
  targetPath?: string;
  /** Only run specific invariant checks by ID */
  only?: string[];
  /** Skip specific invariant checks by ID */
  skip?: string[];
}

/**
 * Convert CollectorArtifact to Artifact for checker compatibility
 */
function toArtifact(collectorArtifact: CollectorArtifact): Artifact {
  return {
    version: '1.0',
    extractedAt: collectorArtifact.extractedAt,
    targetPath: collectorArtifact.codebase.root,
    services: collectorArtifact.services,
    authzCalls: collectorArtifact.authzCalls ?? [],
    cacheOperations: collectorArtifact.cacheOperations ?? [],
    transactionScopes: collectorArtifact.transactionScopes ?? [],
    webhookHandlers: collectorArtifact.webhookHandlers ?? [],
    jobHandlers: collectorArtifact.jobHandlers ?? [],
    membershipMutations: collectorArtifact.membershipMutations ?? [],
    tests: collectorArtifact.tests ?? [],
    routes: collectorArtifact.routes ?? [],
    dataFlows: collectorArtifact.dataFlows,
    callGraph: collectorArtifact.callGraph,
  };
}

/**
 * Run the full staff check audit
 *
 * This is the main programmatic API for running the staff check.
 * It performs two steps:
 * 1. Collect artifacts from the target codebase (facts)
 * 2. Send to cloud API for evaluation (findings)
 *
 * SECURITY: Detection logic runs server-side to protect IP.
 * An API key is required. Get one at https://securitychecks.ai/dashboard/settings/api-keys
 *
 * @example
 * ```ts
 * import { audit } from '@securitychecks/cli';
 *
 * // Requires SECURITYCHECKS_API_KEY environment variable
 * const result = await audit({
 *   targetPath: '/path/to/codebase',
 *   only: ['WEBHOOK.IDEMPOTENT'],
 * });
 *
 * console.log(result.summary);
 * ```
 */
export async function audit(options: AuditOptions = {}): Promise<AuditResult> {
  const startTime = Date.now();

  // SECURITY: Require API key - detection runs server-side to protect IP
  const apiKey = getCloudApiKey();
  if (!apiKey) {
    throw new CLIError(
      ErrorCodes.AUTH_REQUIRED,
      'API key required for scanning',
      {
        details: {
          remediation: `Set SECURITYCHECKS_API_KEY environment variable.
Get your API key at https://securitychecks.ai/dashboard/settings/api-keys

For air-gapped environments, contact sales@securitychecks.ai for enterprise options.`,
        },
      }
    );
  }

  const targetPath = resolveTargetPath(options.targetPath);

  // Step 1: Collect artifacts (facts) - runs locally
  const collectorArtifact = await collect({
    targetPath,
    profile: 'securitychecks',
  });

  // Step 2: Send to cloud for evaluation (findings) - runs server-side
  const cloudResult = await evaluateCloud(collectorArtifact, {
    apiKey,
    baseUrl: getCloudApiBaseUrl(),
    invariants: options.only,
    skip: options.skip,
  });

  // Step 3: Convert to checker-compatible format for result
  const artifact = toArtifact(collectorArtifact);

  // Compute summary from cloud results
  const findings = cloudResult.findings;
  const byPriority = {
    P0: findings.filter((f) => f.severity === 'P0').length,
    P1: findings.filter((f) => f.severity === 'P1').length,
    P2: findings.filter((f) => f.severity === 'P2').length,
  };

  // Synthesize results format from cloud response
  const invariantIds = [...new Set(findings.map(f => f.invariantId))];
  const results = invariantIds.map(id => ({
    invariantId: id,
    passed: !findings.some(f => f.invariantId === id),
    findings: findings.filter(f => f.invariantId === id),
    checkedAt: new Date().toISOString(),
    duration: 0,
  }));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const waived = findings.filter((f) => f.waived).length;

  return {
    version: '1.0',
    targetPath,
    runAt: new Date().toISOString(),
    duration: Date.now() - startTime,
    summary: {
      total: cloudResult.stats.invariantsRun,
      passed,
      failed,
      waived,
      byPriority
    },
    results,
    artifact,
  };
}
