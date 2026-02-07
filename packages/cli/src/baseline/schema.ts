/**
 * Baseline and Waiver Schema Versions
 *
 * These versions are CLI-level (separate from collector artifact schema).
 * Bump these when the storage format changes.
 */

export const BASELINE_SCHEMA_VERSION = '1.0.0';
export const WAIVER_SCHEMA_VERSION = '1.1.0';

export const WAIVER_REASON_KEYS = [
  'false_positive',
  'acceptable_risk',
  'will_fix_later',
  'not_applicable',
  'other',
] as const;

export type WaiverReasonKey = typeof WAIVER_REASON_KEYS[number];

export function isValidWaiverReasonKey(value: string): value is WaiverReasonKey {
  return (WAIVER_REASON_KEYS as readonly string[]).includes(value);
}

// ============================================================================
// Baseline Types
// ============================================================================

/**
 * A baseline entry represents a known finding that should not fail CI.
 * Baselines are used to adopt scheck incrementally on existing codebases.
 */
export interface BaselineEntry {
  /** Stable finding ID (invariantId:hash) */
  findingId: string;
  /** The invariant this finding belongs to */
  invariantId: string;
  /** File where the finding was detected */
  file: string;
  /** Symbol (function/class name) if available */
  symbol?: string;
  /** When this was first added to baseline */
  createdAt: string; // ISO date
  /** When this was last seen in a run */
  lastSeenAt: string; // ISO date
  /** Optional notes explaining why this is baselined */
  notes?: string;
}

/**
 * The baseline file format.
 */
export interface BaselineFile {
  /** Schema version for baseline file format */
  schemaVersion: string;
  /** CLI version that generated this file */
  toolVersion: string;
  /** Collector schema version used when generating findings */
  collectorSchemaVersion?: string;
  /** Tool identifier (e.g., "@securitychecks/cli@0.1.0") */
  generatedBy: string;
  /** When the baseline was last updated (UTC ISO date) */
  updatedAt: string;
  /** Baseline entries keyed by findingId for O(1) lookup */
  entries: Record<string, BaselineEntry>;
}

// ============================================================================
// Waiver Types
// ============================================================================

/**
 * A waiver temporarily suppresses a finding.
 * Unlike baselines, waivers expire and require explicit justification.
 */
export interface WaiverEntry {
  /** Stable finding ID (invariantId:hash) */
  findingId: string;
  /** The invariant this waiver applies to */
  invariantId: string;
  /** File where the finding was detected */
  file: string;
  /** Symbol (function/class name) if available */
  symbol?: string;
  /** Structured waiver reason (optional; aligns with web UI) */
  reasonKey?: WaiverReasonKey;
  /** Why this is being waived (required) */
  reason: string;
  /** Who created the waiver */
  owner: string;
  /** When the waiver expires (ISO date) */
  expiresAt: string;
  /** When the waiver was created */
  createdAt: string; // ISO date
}

/**
 * The waiver file format.
 */
export interface WaiverFile {
  /** Schema version for waiver file format */
  schemaVersion: string;
  /** CLI version that generated this file */
  toolVersion: string;
  /** Tool identifier (e.g., "@securitychecks/cli@0.1.0") */
  generatedBy: string;
  /** When the waiver file was last updated (UTC ISO date) */
  updatedAt: string;
  /** Waiver entries keyed by findingId */
  entries: Record<string, WaiverEntry>;
}

// ============================================================================
// Empty File Factories
// ============================================================================

/** Package identifier for generatedBy field */
export const CLI_PACKAGE_NAME = '@securitychecks/cli';

/** Get the generatedBy string (package@version) */
export function getGeneratedBy(version: string): string {
  return `${CLI_PACKAGE_NAME}@${version}`;
}

export function createEmptyBaseline(version: string = '0.0.0'): BaselineFile {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    toolVersion: version,
    generatedBy: getGeneratedBy(version),
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}

export function createEmptyWaiverFile(version: string = '0.0.0'): WaiverFile {
  return {
    schemaVersion: WAIVER_SCHEMA_VERSION,
    toolVersion: version,
    generatedBy: getGeneratedBy(version),
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}
