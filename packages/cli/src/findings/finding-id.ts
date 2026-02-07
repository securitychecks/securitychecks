/**
 * Stable Finding ID Generation
 *
 * Generates deterministic, stable IDs for findings that survive:
 * - Re-runs
 * - Ordering changes
 * - Remediation/message tweaks
 * - Minor code refactors
 *
 * IDs are NOT stable across:
 * - Moving code to different files
 * - Renaming functions (these are legitimately different anchors)
 *
 * Format: `${invariantId}:${hash}` (e.g., WEBHOOK.IDEMPOTENT:9c31f0a2b4d1)
 */

import { createHash } from 'crypto';
import type { Finding } from '@securitychecks/collector';

// ============================================================================
// Identity Payload Extraction
// ============================================================================

/**
 * Invariant-specific anchor extractors.
 * Each returns additional identity fields beyond the base (invariantId + file + symbol).
 */
type AnchorExtractor = (finding: Finding) => Record<string, string>;

const ANCHOR_EXTRACTORS: Record<string, AnchorExtractor> = {
  // Webhook: include provider from context if available
  'WEBHOOK.IDEMPOTENT': (finding) => {
    const context = finding.evidence[0]?.context ?? '';
    // Extract provider from context like "stripe: handleStripeWebhook"
    const providerMatch = context.match(/^(stripe|github|slack|svix|generic):/i);
    return {
      provider: providerMatch?.[1]?.toLowerCase() ?? '',
    };
  },

  // Transaction: include side effect type from message
  'TRANSACTION.POST_COMMIT.SIDE_EFFECTS': (finding) => {
    // Extract side effect type from message like "contains email side effect"
    const typeMatch = finding.message.match(/contains (\w+) side effect/i);
    return {
      sideEffectType: typeMatch?.[1]?.toLowerCase() ?? '',
    };
  },

  // Membership revocation: include mutation type
  'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE': (finding) => {
    const context = finding.evidence[0]?.context ?? '';
    // Extract mutation type from context
    const mutationMatch = context.match(/mutationType[:\s]+(\w+)/i);
    return {
      mutationType: mutationMatch?.[1]?.toLowerCase() ?? '',
    };
  },

  // Keys revocation: include entity type
  'AUTHZ.KEYS.REVOCATION.IMMEDIATE': (finding) => {
    const context = finding.evidence[0]?.context ?? '';
    const entityMatch = context.match(/entity[:\s]+(\w+)/i);
    return {
      entity: entityMatch?.[1]?.toLowerCase() ?? '',
    };
  },
};

/**
 * Extract the identity payload for a finding.
 * This is what gets hashed to produce the findingId.
 */
export function extractIdentityPayload(finding: Finding): Record<string, string> {
  const primary = finding.evidence[0];

  // Base identity: invariantId + file + symbol
  const base: Record<string, string> = {
    invariantId: finding.invariantId.toLowerCase(),
    file: normalizePath(primary?.file ?? ''),
    symbol: (primary?.symbol ?? '').toLowerCase(),
  };

  // Add invariant-specific anchors
  const extractor = ANCHOR_EXTRACTORS[finding.invariantId];
  if (extractor) {
    const anchors = extractor(finding);
    Object.assign(base, anchors);
  }

  return base;
}

// ============================================================================
// Path Normalization
// ============================================================================

/**
 * Normalize file path for consistent hashing.
 * - Use forward slashes
 * - Remove leading ./ or /
 * - Lowercase
 * - Trim whitespace
 */
function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/') // Windows backslashes
    .replace(/^\.\//, '') // Leading ./
    .replace(/^\//, '') // Leading /
    .toLowerCase();
}

// ============================================================================
// Hash Generation
// ============================================================================

/**
 * Generate a short, stable hash from the identity payload.
 * Uses SHA-256 truncated to 12 hex characters.
 */
function hashPayload(payload: Record<string, string>): string {
  // Sort keys for deterministic ordering
  const keys = Object.keys(payload).sort();
  const canonical = keys.map((k) => `${k}:${payload[k]}`).join('|');

  const hash = createHash('sha256').update(canonical).digest('hex');

  // Take first 12 characters for readability while maintaining uniqueness
  return hash.slice(0, 12);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a stable findingId for a finding.
 *
 * @example
 * const id = generateFindingId(finding);
 * // "WEBHOOK.IDEMPOTENT:9c31f0a2b4d1"
 */
export function generateFindingId(finding: Finding): string {
  const payload = extractIdentityPayload(finding);
  const hash = hashPayload(payload);
  return `${finding.invariantId}:${hash}`;
}

/**
 * Add findingId to a finding (mutates the finding).
 * Returns the same finding for chaining.
 */
export function attachFindingId<T extends Finding>(finding: T): T & { findingId: string } {
  const findingId = generateFindingId(finding);
  return Object.assign(finding, { findingId });
}

/**
 * Add findingIds to all findings in a list.
 */
export function attachFindingIds<T extends Finding>(findings: T[]): (T & { findingId: string })[] {
  return findings.map(attachFindingId);
}

// ============================================================================
// Baseline/Waiver Types
// ============================================================================

/**
 * A baseline entry stores known findings that should not fail CI.
 */
export interface BaselineEntry {
  findingId: string;
  invariantId: string;
  file: string;
  symbol?: string;
  firstSeenAt: string; // ISO date
  lastSeenAt: string; // ISO date
}

/**
 * A waiver temporarily suppresses a finding.
 */
export interface WaiverEntry {
  findingId: string;
  invariantId: string;
  reasonKey?: string;
  reason: string;
  expiresAt: string; // ISO date
  createdBy: string;
  createdAt: string; // ISO date
}

/**
 * Convert a finding to a baseline entry.
 */
export function toBaselineEntry(finding: Finding & { findingId: string }): BaselineEntry {
  const now = new Date().toISOString();
  return {
    findingId: finding.findingId,
    invariantId: finding.invariantId,
    file: finding.evidence[0]?.file ?? '',
    symbol: finding.evidence[0]?.symbol,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
