/**
 * Calibration API Client
 *
 * "The SaaS advises. The local tool decides."
 *
 * This module handles communication with the SecurityChecks Calibration API.
 * The API provides confidence tuning based on aggregate data from many codebases.
 *
 * Key principles:
 * - No source code is ever sent (only patterns and metadata)
 * - API suggestions are advisory only
 * - Local tool retains veto power via minConfidence threshold
 * - Fails safely to local-only mode on network errors
 */

import type {
  CalibrationConfig,
  CalibrationRequest,
  CalibrationResponse,
  Finding,
  FindingCalibration,
  Severity,
  Artifact,
} from '@securitychecks/collector';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

// CLI version for telemetry
const CLI_VERSION = '0.1.0';

// Default cache path
const DEFAULT_CACHE_PATH = '.securitychecks/calibration-cache.json';

interface CacheEntry {
  response: CalibrationResponse;
  timestamp: number;
  requestHash: string;
}

interface CalibrationCache {
  version: '1.0';
  entries: Record<string, CacheEntry>;
}

/**
 * Create a hash for a calibration request (for caching)
 */
function hashRequest(request: CalibrationRequest): string {
  // Simple hash based on key fields (not crypto-secure, just for caching)
  const key = JSON.stringify({
    invariantId: request.invariantId,
    localSeverity: request.localSeverity,
    pattern: request.pattern,
    context: request.context,
  });
  // Simple string hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Load calibration cache from disk
 */
async function loadCache(cachePath: string): Promise<CalibrationCache> {
  try {
    if (existsSync(cachePath)) {
      const content = await readFile(cachePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Cache corrupted or unreadable, start fresh
  }
  return { version: '1.0', entries: {} };
}

/**
 * Save calibration cache to disk
 */
async function saveCache(cachePath: string, cache: CalibrationCache): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Failed to save cache, not critical
  }
}

/**
 * Extract calibration-safe pattern from a finding
 * This is what we send to the API - no source code, just metadata
 */
export function extractPatternFromFinding(finding: Finding): CalibrationRequest['pattern'] {
  const pattern: CalibrationRequest['pattern'] = {};

  // Extract from structured evidence if available
  if (finding.structuredEvidence) {
    const se = finding.structuredEvidence;

    if (se.mutationSite) {
      pattern.functionName = se.mutationSite.functionName;
      pattern.mutationType = se.mutationSite.mutationType;
      pattern.entity = se.mutationSite.entity;
    }

    pattern.signals = se.signals;
    pattern.confidence = se.confidence;

    pattern.indicators = {
      hasCacheInvalidation: (se.invalidationSites?.length ?? 0) > 0,
      hasTests: (se.testsCovering?.length ?? 0) > 0,
    };
  }

  // Extract from basic evidence as fallback
  const firstEvidence = finding.evidence[0];
  if (firstEvidence?.symbol && !pattern.functionName) {
    pattern.functionName = firstEvidence.symbol;
  }

  return pattern;
}

/**
 * Detect framework from artifact
 */
export function detectFramework(artifact: Artifact): string | undefined {
  // Check routes for framework hints
  if (artifact.routes && artifact.routes.length > 0) {
    const frameworks = artifact.routes.map((r) => r.framework);
    const counts = new Map<string, number>();
    for (const f of frameworks) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    // Return most common non-unknown framework
    let maxFramework: string | undefined;
    let maxCount = 0;
    for (const [f, c] of counts) {
      if (f !== 'unknown' && c > maxCount) {
        maxFramework = f;
        maxCount = c;
      }
    }
    return maxFramework;
  }
  return undefined;
}

/**
 * Build context for calibration request
 */
export function buildContext(
  artifact: Artifact,
  invariantId: string,
  allFindings: Finding[]
): CalibrationRequest['context'] {
  const findingsOfType = allFindings.filter((f) => f.invariantId === invariantId);

  return {
    framework: detectFramework(artifact),
    serviceCount: artifact.services.length,
    findingCount: findingsOfType.length,
    hasTests: (artifact.tests?.length ?? 0) > 0,
  };
}

/**
 * Call the Calibration API for a single finding
 */
async function callCalibrationAPI(
  request: CalibrationRequest,
  config: CalibrationConfig
): Promise<CalibrationResponse | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        'X-Client-Version': CLI_VERSION,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // API error - fail safe to local result
      return null;
    }

    const data = await response.json();
    return data as CalibrationResponse;
  } catch {
    // Network error, timeout, etc. - fail safe to local result
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Calibrate a single finding
 */
export async function calibrateFinding(
  finding: Finding,
  artifact: Artifact,
  allFindings: Finding[],
  config: CalibrationConfig,
  cache: CalibrationCache
): Promise<Finding> {
  // Build request
  const request: CalibrationRequest = {
    invariantId: finding.invariantId,
    localSeverity: finding.severity,
    pattern: extractPatternFromFinding(finding),
    context: buildContext(artifact, finding.invariantId, allFindings),
    meta: {
      clientVersion: CLI_VERSION,
      requestId: randomUUID(),
      timestamp: new Date().toISOString(),
    },
  };

  const requestHash = hashRequest(request);

  // Check cache first
  if (config.cache?.enabled) {
    const cached = cache.entries[requestHash];
    if (cached) {
      const age = Date.now() - cached.timestamp;
      const ttlMs = (config.cache.ttl ?? 86400) * 1000;
      if (age < ttlMs) {
        // Use cached response
        return applyCalibration(finding, cached.response, config);
      }
    }
  }

  // Call API
  const response = await callCalibrationAPI(request, config);

  if (!response) {
    // API failed - return finding unchanged
    return finding;
  }

  // Cache response
  if (config.cache?.enabled) {
    cache.entries[requestHash] = {
      response,
      timestamp: Date.now(),
      requestHash,
    };
  }

  return applyCalibration(finding, response, config);
}

/**
 * Apply calibration response to a finding
 */
function applyCalibration(
  finding: Finding,
  response: CalibrationResponse,
  config: CalibrationConfig
): Finding {
  const originalSeverity = finding.severity;

  // Check if we should apply the recommendation
  const shouldApply = response.confidence >= config.minConfidence && !response.suppress;

  const calibration: FindingCalibration = {
    apiRecommendation: response,
    applied: shouldApply,
    originalSeverity,
    reason: shouldApply
      ? `API confidence ${(response.confidence * 100).toFixed(0)}% >= threshold ${(config.minConfidence * 100).toFixed(0)}%`
      : `API confidence ${(response.confidence * 100).toFixed(0)}% < threshold ${(config.minConfidence * 100).toFixed(0)}%`,
  };

  // Create new finding with calibration data
  const calibratedFinding: Finding = {
    ...finding,
    calibration,
  };

  // Apply severity change if recommended and above threshold
  if (shouldApply && response.recommendedSeverity !== originalSeverity) {
    calibratedFinding.severity = response.recommendedSeverity;
  }

  return calibratedFinding;
}

/**
 * Calibrate all findings in a batch
 * This is the main entry point for calibration
 */
export async function calibrateFindings(
  findings: Finding[],
  artifact: Artifact,
  config: CalibrationConfig,
  targetPath: string
): Promise<Finding[]> {
  if (!config.enabled) {
    return findings;
  }

  // Load cache
  const cachePath = config.cache?.path ?? join(targetPath, DEFAULT_CACHE_PATH);
  const cache = await loadCache(cachePath);

  // Calibrate each finding
  const calibratedFindings = await Promise.all(
    findings.map((finding) => calibrateFinding(finding, artifact, findings, config, cache))
  );

  // Save cache
  if (config.cache?.enabled) {
    await saveCache(cachePath, cache);
  }

  return calibratedFindings;
}

/**
 * Get calibration statistics from findings
 */
export function getCalibrationStats(findings: Finding[]): {
  total: number;
  calibrated: number;
  applied: number;
  unchanged: number;
  severityChanges: { from: Severity; to: Severity; count: number }[];
} {
  const calibrated = findings.filter((f) => f.calibration);
  const applied = calibrated.filter((f) => f.calibration?.applied);

  const changes = new Map<string, number>();
  for (const finding of applied) {
    if (finding.calibration && finding.calibration.originalSeverity !== finding.severity) {
      const key = `${finding.calibration.originalSeverity}->${finding.severity}`;
      changes.set(key, (changes.get(key) ?? 0) + 1);
    }
  }

  const severityChanges = Array.from(changes.entries()).map(([key, count]) => {
    const [from, to] = key.split('->') as [Severity, Severity];
    return { from, to, count };
  });

  return {
    total: findings.length,
    calibrated: calibrated.length,
    applied: applied.length,
    unchanged: findings.length - applied.length,
    severityChanges,
  };
}

// ============================================================================
// Aggregate Calibration (from SaaS learning loop)
// ============================================================================

const AGGREGATE_CALIBRATION_ENDPOINT = 'https://api.securitychecks.ai/v1/calibration';

// In-memory cache for aggregate data (1 hour TTL)
const AGGREGATE_CACHE_TTL_MS = 60 * 60 * 1000;
let aggregateCache: AggregateCalibrationData | null = null;
let aggregateCacheTimestamp = 0;

export interface AggregateCalibrationConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  timeout?: number;
  cacheEnabled?: boolean;
}

export interface FrameworkBaseline {
  framework: string;
  avgFindings: number;
  avgP0: number;
  avgP1: number;
  avgP2: number;
  scansAnalyzed: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface InvariantStats {
  invariantId: string;
  avgPerScan: number;
  hitRate: number;
  p0Rate: number;
  p1Rate: number;
  p2Rate: number;
}

export interface PatternStats {
  patternId: string;
  framework: string | null;
  accuracy: number | null;
  matchesPerScan: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CorrelationStats {
  ruleId: string;
  accuracy: number | null;
  escalationRate: number | null;
  isVerified: boolean;
}

export interface AggregateCalibrationData {
  version: string;
  generatedAt: string;
  frameworks: FrameworkBaseline[];
  invariants: InvariantStats[];
  patterns: PatternStats[];
  correlations: CorrelationStats[];
  meta: {
    totalScansAnalyzed: number;
    lastUpdated: string | null;
  };
}

export interface AggregateCalibrationResult {
  data: AggregateCalibrationData | null;
  fromCache: boolean;
  error?: string;
}

/**
 * Fetch aggregate calibration data for the specified frameworks
 */
export async function fetchAggregateCalibration(
  frameworks: string[],
  config: AggregateCalibrationConfig
): Promise<AggregateCalibrationResult> {
  if (!config.enabled) {
    return { data: null, fromCache: false, error: 'Aggregate calibration disabled' };
  }

  // Check cache first
  if (config.cacheEnabled !== false && aggregateCache && Date.now() - aggregateCacheTimestamp < AGGREGATE_CACHE_TTL_MS) {
    return { data: aggregateCache, fromCache: true };
  }

  const endpoint = config.endpoint ?? AGGREGATE_CALIBRATION_ENDPOINT;
  const timeout = config.timeout ?? 5000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const url = new URL(endpoint);
      url.searchParams.set('frameworks', frameworks.join(','));

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          data: null,
          fromCache: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json() as AggregateCalibrationData;

      // Update cache
      if (config.cacheEnabled !== false) {
        aggregateCache = data;
        aggregateCacheTimestamp = Date.now();
      }

      return { data, fromCache: false };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    // Calibration failures are non-fatal
    return {
      data: null,
      fromCache: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Clear the aggregate calibration cache
 */
export function clearAggregateCache(): void {
  aggregateCache = null;
  aggregateCacheTimestamp = 0;
}

/**
 * Get the framework baseline for comparison
 */
export function getFrameworkBaseline(
  calibration: AggregateCalibrationData,
  framework: string
): FrameworkBaseline | undefined {
  return calibration.frameworks.find((f) => f.framework === framework);
}

/**
 * Check if a pattern should be skipped due to low accuracy
 */
export function shouldSkipPattern(
  calibration: AggregateCalibrationData,
  patternId: string,
  framework?: string,
  accuracyThreshold = 0.3
): boolean {
  const pattern = calibration.patterns.find(
    (p) => p.patternId === patternId &&
      (p.framework === framework || p.framework === null)
  );

  if (!pattern || pattern.accuracy === null) {
    return false; // No data, don't skip
  }

  // Only skip if we have high confidence it's a bad pattern
  if (pattern.confidence !== 'high') {
    return false;
  }

  return pattern.accuracy < accuracyThreshold;
}

/**
 * Get patterns that should be skipped for a framework
 */
export function getSkippedPatterns(
  calibration: AggregateCalibrationData,
  framework?: string,
  accuracyThreshold = 0.3
): string[] {
  return calibration.patterns
    .filter((p) => {
      if (p.accuracy === null || p.confidence !== 'high') {
        return false;
      }
      if (framework && p.framework && p.framework !== framework) {
        return false;
      }
      return p.accuracy < accuracyThreshold;
    })
    .map((p) => p.patternId);
}

/**
 * Get correlation rules with high confidence
 */
export function getVerifiedCorrelations(
  calibration: AggregateCalibrationData
): CorrelationStats[] {
  return calibration.correlations.filter((c) => c.isVerified);
}

/**
 * Calculate relative finding severity based on framework baseline
 */
export function calculateRelativeSeverity(
  findingCount: number,
  baseline: FrameworkBaseline,
  type: 'total' | 'P0' | 'P1' | 'P2' = 'total'
): 'below_average' | 'average' | 'above_average' | 'critical' {
  let avg: number;
  switch (type) {
    case 'P0':
      avg = baseline.avgP0;
      break;
    case 'P1':
      avg = baseline.avgP1;
      break;
    case 'P2':
      avg = baseline.avgP2;
      break;
    default:
      avg = baseline.avgFindings;
  }

  if (avg === 0) {
    return findingCount > 0 ? 'above_average' : 'average';
  }

  const ratio = findingCount / avg;

  if (ratio < 0.5) return 'below_average';
  if (ratio < 1.5) return 'average';
  if (ratio < 3) return 'above_average';
  return 'critical';
}

/**
 * Generate calibration summary for output
 */
export function formatAggregateCalibrationSummary(
  calibration: AggregateCalibrationData,
  frameworks: string[],
  findings: { P0: number; P1: number; P2: number; total: number }
): string {
  const lines: string[] = [];

  // Framework comparison
  for (const fw of frameworks) {
    const baseline = getFrameworkBaseline(calibration, fw);
    if (baseline && baseline.confidence !== 'low') {
      const severity = calculateRelativeSeverity(findings.total, baseline);
      const avgStr = baseline.avgFindings.toFixed(1);

      if (severity === 'below_average') {
        lines.push(`${fw}: ${findings.total} findings (${avgStr} avg) - Below average`);
      } else if (severity === 'above_average') {
        lines.push(`${fw}: ${findings.total} findings (${avgStr} avg) - Above average`);
      } else if (severity === 'critical') {
        lines.push(`${fw}: ${findings.total} findings (${avgStr} avg) - Significantly above average`);
      } else {
        lines.push(`${fw}: ${findings.total} findings (${avgStr} avg) - Typical`);
      }
    }
  }

  // Skipped patterns
  const skipped = getSkippedPatterns(calibration, frameworks[0]);
  if (skipped.length > 0) {
    lines.push(`Skipped ${skipped.length} low-accuracy patterns`);
  }

  // Data confidence
  if (calibration.meta.totalScansAnalyzed < 100) {
    lines.push(`Calibration based on ${calibration.meta.totalScansAnalyzed} scans (limited data)`);
  }

  return lines.join('\n');
}

/**
 * Check if aggregate calibration is disabled via environment
 */
export function isAggregateCalibrationDisabled(): boolean {
  return process.env['SECURITYCHECKS_CALIBRATION'] === 'false';
}
