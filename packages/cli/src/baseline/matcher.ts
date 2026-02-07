/**
 * Baseline and Waiver Matching
 *
 * Applies baselines and waivers to findings, categorizing them for CI decisions.
 */

import type { Finding, Severity } from '@securitychecks/collector';
import { generateFindingId, attachFindingId } from '../findings/finding-id.js';
import { isInBaseline, getValidWaiver } from './storage.js';
import type { BaselineFile, WaiverFile, WaiverEntry } from './schema.js';

// ============================================================================
// Categorized Finding Types
// ============================================================================

/**
 * A finding with its baseline/waiver status resolved.
 */
export interface CategorizedFinding extends Finding {
  findingId: string;
  /** Whether this finding is in the baseline */
  isBaselined: boolean;
  /** Active waiver if present */
  waiver?: WaiverEntry;
  /** Whether this finding should fail CI */
  shouldFail: boolean;
}

/**
 * Result of categorizing findings.
 */
export interface CategorizationResult {
  /** All findings with status */
  all: CategorizedFinding[];
  /** New findings not in baseline (may fail CI) */
  new: CategorizedFinding[];
  /** Findings in baseline (won't fail CI) */
  baselined: CategorizedFinding[];
  /** Findings with active waivers (won't fail CI) */
  waived: CategorizedFinding[];
  /** Summary counts */
  counts: {
    total: number;
    new: number;
    baselined: number;
    waived: number;
    willFail: number;
  };
}

// ============================================================================
// Categorization Logic
// ============================================================================

/**
 * Categorize findings against baseline and waivers.
 *
 * @param findings - Raw findings from checkers
 * @param baseline - Loaded baseline file
 * @param waivers - Loaded waiver file
 * @param failSeverities - Which severities should fail CI (default: P0, P1)
 */
export function categorizeFindings(
  findings: Finding[],
  baseline: BaselineFile,
  waivers: WaiverFile,
  failSeverities: Severity[] = ['P0', 'P1']
): CategorizationResult {
  const categorized: CategorizedFinding[] = [];
  const newFindings: CategorizedFinding[] = [];
  const baselinedFindings: CategorizedFinding[] = [];
  const waivedFindings: CategorizedFinding[] = [];

  for (const finding of findings) {
    const findingId = generateFindingId(finding);
    const isBaselined = isInBaseline(baseline, finding);
    const waiver = getValidWaiver(waivers, finding);

    // Determine if this finding should fail CI
    const isFailSeverity = failSeverities.includes(finding.severity);
    const shouldFail = isFailSeverity && !isBaselined && !waiver;

    const categorizedFinding: CategorizedFinding = {
      ...finding,
      findingId,
      isBaselined,
      waiver,
      shouldFail,
    };

    categorized.push(categorizedFinding);

    if (waiver) {
      waivedFindings.push(categorizedFinding);
    } else if (isBaselined) {
      baselinedFindings.push(categorizedFinding);
    } else {
      newFindings.push(categorizedFinding);
    }
  }

  return {
    all: categorized,
    new: newFindings,
    baselined: baselinedFindings,
    waived: waivedFindings,
    counts: {
      total: categorized.length,
      new: newFindings.length,
      baselined: baselinedFindings.length,
      waived: waivedFindings.length,
      willFail: categorized.filter((f) => f.shouldFail).length,
    },
  };
}

/**
 * Determine CI exit status based on categorized findings.
 *
 * @returns 0 for success, 1 for failure
 */
export function getCIExitCode(result: CategorizationResult): number {
  return result.counts.willFail > 0 ? 1 : 0;
}

/**
 * Get a summary message for CI output.
 */
export function getCISummary(result: CategorizationResult): string {
  const { counts } = result;

  if (counts.total === 0) {
    return 'No findings detected.';
  }

  const parts: string[] = [];

  if (counts.willFail > 0) {
    parts.push(`${counts.willFail} new finding(s) require attention`);
  }

  if (counts.baselined > 0) {
    parts.push(`${counts.baselined} baselined`);
  }

  if (counts.waived > 0) {
    parts.push(`${counts.waived} waived`);
  }

  if (counts.willFail === 0) {
    parts.unshift('All findings are baselined or waived');
  }

  return parts.join(', ') + '.';
}

// ============================================================================
// Collision Detection
// ============================================================================

/**
 * Detect and handle findingId collisions.
 * Returns findings with unique IDs (appending :a, :b, etc. if needed).
 *
 * This is a defensive measure - collisions should be extremely rare with
 * 12 hex chars of SHA-256, but we define the behavior explicitly.
 */
export function resolveCollisions(findings: Finding[]): (Finding & { findingId: string })[] {
  const seen = new Map<string, number>();
  const result: (Finding & { findingId: string })[] = [];

  for (const finding of findings) {
    let findingId = generateFindingId(finding);

    // Check for collision
    const count = seen.get(findingId) ?? 0;
    if (count > 0) {
      // Append suffix: :a, :b, :c, etc.
      const suffix = String.fromCharCode(96 + count); // a=97, so 96+1=a
      findingId = `${findingId}:${suffix}`;
    }
    seen.set(generateFindingId(finding), count + 1);

    result.push({
      ...finding,
      findingId,
    });
  }

  return result;
}

/**
 * Check if there are any findingId collisions in a set of findings.
 * Returns true if collisions exist.
 */
export function hasCollisions(findings: Finding[]): boolean {
  const ids = new Set<string>();

  for (const finding of findings) {
    const id = generateFindingId(finding);
    if (ids.has(id)) {
      return true;
    }
    ids.add(id);
  }

  return false;
}
