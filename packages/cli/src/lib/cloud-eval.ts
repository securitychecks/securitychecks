/**
 * Cloud Evaluation Client
 *
 * Sends artifacts to the cloud API for async server-side evaluation.
 * Artifacts are stored in R2 and processed by Fly.io workers.
 *
 * Architecture:
 * 1. CLI collects artifact locally (code never leaves)
 * 2. Artifact sent to /api/v1/evaluate, stored in R2
 * 3. Server queues QStash job for Fly.io worker
 * 4. CLI polls /api/v1/scans/{id} until complete
 * 5. Findings returned to CLI for display
 */

import type { CollectorArtifact, Finding } from '@securitychecks/collector';
import { CLIError, ErrorCodes } from './errors.js';
import { detectCIContext, type CIContext } from './ci-detect.js';

// Re-export for convenience
export { detectCIContext, type CIContext } from './ci-detect.js';

/**
 * Build request headers with optional Vercel deployment protection bypass.
 * Set VERCEL_AUTOMATION_BYPASS_SECRET env var to bypass Vercel deployment protection
 * on preview deployments.
 */
function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const bypassSecret = process.env['VERCEL_AUTOMATION_BYPASS_SECRET'];
  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
  }
  return headers;
}

export interface CloudEvaluateOptions {
  /** API key for authentication */
  apiKey: string;
  /** Cloud API base URL */
  baseUrl: string;
  /** Specific invariants to run (default: all) */
  invariants?: string[];
  /** Invariants to skip */
  skip?: string[];
  /** Minimum severity to return */
  severity?: 'P0' | 'P1' | 'P2';
  /** Project slug for scan association */
  projectSlug?: string;
  /** Timeout in ms (default: 300000 = 5 min) */
  timeout?: number;
  /** Poll interval in ms (default: 2000 = 2s) */
  pollInterval?: number;
  /** Progress callback */
  onProgress?: EvaluationProgressCallback;
  /** CI context (auto-detected if not provided) */
  ciContext?: CIContext | null;
}

export interface CloudEvaluateResult {
  findings: Finding[];
  stats: {
    invariantsRun: number;
    patternsRun: number;
    findingsCount: number;
    executionMs: number;
  };
  usage: {
    scansUsed: number;
    scansRemaining: number;
  };
}

export interface CloudEvaluateError {
  error: string;
  details?: unknown;
  usage?: {
    scansUsed: number;
    scansRemaining: number;
  };
}

/** Scan status from API */
export type ScanStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** Progress callback for evaluation */
export type EvaluationProgressCallback = (info: {
  status: ScanStatus;
  message?: string;
}) => void;

/** Response from submit endpoint */
interface SubmitResult {
  scanId: string;
  status: ScanStatus;
  pollUrl: string;
  usage?: {
    scansUsed: number;
    scansRemaining: number;
  };
}

/** Response from scan status endpoint */
interface ScanStatusResult {
  id: string;
  status: ScanStatus;
  findings?: Finding[];
  stats?: {
    invariantsRun: number;
    patternsRun: number;
    findingsCount: number;
    executionMs: number;
  };
  usage?: {
    scansUsed: number;
    scansRemaining: number;
  };
  errorMessage?: string;
}

/**
 * Check if cloud evaluation is available
 */
export function isCloudEvalAvailable(apiKey?: string): boolean {
  return !!apiKey;
}

/**
 * Build the artifact payload for cloud evaluation
 */
function buildEvaluatePayload(artifact: CollectorArtifact, options: CloudEvaluateOptions) {
  // Auto-detect CI context if not provided
  const ciContext = options.ciContext !== undefined ? options.ciContext : detectCIContext();

  return {
    artifact: {
      version: artifact.version,
      schemaVersion: artifact.schemaVersion,
      profile: artifact.profile,
      extractedAt: artifact.extractedAt,
      targetPath: artifact.codebase?.root,
      codebase: {
        file_count: artifact.codebase?.filesScanned ?? 0,
        languages: artifact.codebase?.languages ?? [],
      },
      services: artifact.services,
      authzCalls: artifact.authzCalls ?? [],
      cacheOperations: artifact.cacheOperations ?? [],
      transactionScopes: artifact.transactionScopes ?? [],
      webhookHandlers: artifact.webhookHandlers ?? [],
      jobHandlers: artifact.jobHandlers ?? [],
      membershipMutations: artifact.membershipMutations ?? [],
      tests: artifact.tests ?? [],
      routes: artifact.routes ?? [],
      callGraph: artifact.callGraph,
      dataFlow: artifact.dataFlows?.flows ?? [],
      rlsPolicies: artifact.rlsArtifact?.rlsPolicies ?? [],
    },
    options: {
      invariants: options.invariants,
      skip: options.skip,
      severity: options.severity,
      projectSlug: options.projectSlug,
      // CI context for scan association (enables PR comments)
      branch: ciContext?.branch,
      commitSha: ciContext?.commitSha,
      prNumber: ciContext?.prNumber,
    },
  };
}

/**
 * Submit artifact for async evaluation
 * Returns scan ID for polling
 */
async function submitForEvaluation(
  artifact: CollectorArtifact,
  options: CloudEvaluateOptions
): Promise<SubmitResult> {
  const endpoint = `${options.baseUrl}/api/v1/evaluate`;
  const payload = buildEvaluatePayload(artifact, options);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as CloudEvaluateError;

    if (response.status === 401) {
      throw new CLIError(ErrorCodes.CLOUD_AUTH_FAILED, 'Invalid API key. Check your SECURITYCHECKS_API_KEY.');
    }

    if (response.status === 413) {
      throw new CLIError(
        ErrorCodes.CLOUD_API_ERROR,
        `Artifact too large. ${errorBody.details || 'Contact support if this persists.'}`,
        { details: errorBody.details }
      );
    }

    if (response.status === 429) {
      const remaining = errorBody.usage?.scansRemaining ?? 0;
      throw new CLIError(
        ErrorCodes.CLOUD_RATE_LIMITED,
        `Monthly scan limit reached (${remaining} remaining). Upgrade at https://securitychecks.ai/pricing`,
        { details: { scansRemaining: remaining } }
      );
    }

    if (response.status === 503) {
      throw new CLIError(ErrorCodes.CLOUD_API_ERROR, 'Cloud evaluation temporarily unavailable. Try again later.');
    }

    throw new CLIError(
      ErrorCodes.CLOUD_API_ERROR,
      errorBody.error || `Cloud API error: ${response.status}`,
      { details: errorBody }
    );
  }

  return (await response.json()) as SubmitResult;
}

/**
 * Poll for evaluation results
 * Blocks until scan completes, fails, or times out
 */
async function pollForResults(
  scanId: string,
  options: CloudEvaluateOptions
): Promise<CloudEvaluateResult> {
  const timeout = options.timeout ?? 300000; // 5 min default
  const pollInterval = options.pollInterval ?? 2000; // 2s default
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const response = await fetch(`${options.baseUrl}/api/v1/scans/${scanId}`, {
      method: 'GET',
      headers: buildHeaders({
        Authorization: `Bearer ${options.apiKey}`,
      }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new CLIError(ErrorCodes.CLOUD_NOT_FOUND, `Scan ${scanId} not found`);
      }
      throw new CLIError(ErrorCodes.CLOUD_API_ERROR, `Failed to get scan status: ${response.status}`);
    }

    const scan = (await response.json()) as ScanStatusResult;

    // Report progress
    options.onProgress?.({
      status: scan.status,
      message: scan.status === 'RUNNING' ? 'Evaluating...' : undefined,
    });

    if (scan.status === 'COMPLETED') {
      return {
        findings: scan.findings ?? [],
        stats: scan.stats ?? {
          invariantsRun: 0,
          patternsRun: 0,
          findingsCount: scan.findings?.length ?? 0,
          executionMs: Date.now() - startTime,
        },
        usage: scan.usage ?? { scansUsed: 0, scansRemaining: 0 },
      };
    }

    if (scan.status === 'FAILED') {
      throw new CLIError(
        ErrorCodes.CLOUD_API_ERROR,
        `Scan failed: ${scan.errorMessage ?? 'Unknown error'}`,
        { details: { scanId, errorMessage: scan.errorMessage } }
      );
    }

    if (scan.status === 'CANCELLED') {
      throw new CLIError(ErrorCodes.CLOUD_API_ERROR, 'Scan was cancelled', { details: { scanId } });
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new CLIError(
    ErrorCodes.CHECK_TIMEOUT,
    `Scan timed out after ${timeout / 1000}s. Check dashboard for results.`,
    { details: { timeoutMs: timeout, scanId } }
  );
}

/**
 * Evaluate artifact via cloud API (async with polling)
 *
 * @param artifact The artifact to evaluate
 * @param options Evaluation options
 * @throws Error if evaluation fails or times out
 */
export async function evaluateCloud(
  artifact: CollectorArtifact,
  options: CloudEvaluateOptions
): Promise<CloudEvaluateResult> {
  // Submit artifact for evaluation
  const { scanId } = await submitForEvaluation(artifact, options);

  // Report initial status
  options.onProgress?.({
    status: 'PENDING',
    message: 'Submitted for evaluation...',
  });

  // Poll for results
  return pollForResults(scanId, options);
}

/**
 * Check cloud API health
 */
export async function checkCloudHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get available invariants from cloud API
 */
export async function getCloudInvariants(
  baseUrl: string,
  apiKey: string
): Promise<Array<{ id: string; name: string; description: string; severity: string }>> {
  const response = await fetch(`${baseUrl}/api/v1/evaluate`, {
    method: 'GET',
    headers: buildHeaders({
      Authorization: `Bearer ${apiKey}`,
    }),
  });

  if (!response.ok) {
    throw new CLIError(ErrorCodes.CLOUD_API_ERROR, `Failed to fetch invariants: ${response.status}`);
  }

  const data = (await response.json()) as {
    invariants: Array<{ id: string; name: string; description: string; severity: string }>;
  };
  return data.invariants;
}
