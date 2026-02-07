/**
 * Pro Patterns - Framework-specific detection rules
 *
 * Patterns extend the built-in invariant checkers with:
 * - Framework-specific detection (Next.js, Prisma, Stripe, etc.)
 * - More precise matching (fewer false positives)
 * - Continuous updates from SaaS
 *
 * "Patterns add coverage. Calibration adds precision."
 */

import type { Severity } from './types.js';

// ============================================================================
// Pattern Definition Schema
// ============================================================================

/**
 * A pattern definition that extends a built-in invariant with
 * framework-specific detection rules.
 */
export interface PatternDefinition {
  /** Unique pattern ID (e.g., "nextjs.server-action.unprotected") */
  id: string;

  /** Semantic version */
  version: string;

  /** Which invariant this pattern extends */
  invariantId: string;

  /** Human-readable name */
  name: string;

  /** Detailed description */
  description: string;

  /** When this pattern applies */
  applicability: PatternApplicability;

  /** What to detect */
  detection: PatternDetection;

  /** What finding to report */
  finding: PatternFinding;

  /** Metadata */
  metadata: PatternMetadata;
}

/**
 * Conditions for when a pattern applies to a codebase.
 */
export interface PatternApplicability {
  /** Required frameworks (e.g., ["nextjs", "prisma"]) */
  frameworks: string[];

  /** Framework version constraints (e.g., ">=14", "^3.0.0") */
  frameworkVersions?: string;

  /** File patterns to match (glob) */
  filePatterns?: string[];

  /** Required dependencies in package.json */
  requiredDependencies?: string[];

  /** Patterns that must NOT be present */
  excludePatterns?: string[];
}

/**
 * Detection strategies for finding pattern matches.
 */
export interface PatternDetection {
  /** Code-based pattern matching (simpler) */
  codePatterns?: CodePattern[];

  /** AST-based pattern matching (structural) */
  astPatterns?: ASTPattern[];

  /** Artifact-based conditions (uses collector output) */
  artifactConditions?: ArtifactCondition[];
}

// ============================================================================
// Code Pattern Matching
// ============================================================================

/**
 * Simple code pattern matching using string/regex patterns.
 */
export interface CodePattern {
  /** Main pattern to match (string or regex) */
  pattern: string;

  /** Pattern must also contain this */
  and?: string | string[];

  /** Pattern must NOT contain this */
  not?: string | string[];

  /** Nearby code requirements */
  requiresNearby?: NearbyRequirement;

  /** Invert the match (flag if pattern is NOT found) */
  invert?: boolean;

  /** Context for the match */
  context?: CodePatternContext;
}

/**
 * Requirements for code that must be nearby the match.
 */
export interface NearbyRequirement {
  /** Any of these patterns must be present */
  any?: string[];

  /** All of these patterns must be present */
  all?: string[];

  /** None of these patterns must be present */
  not?: string[];

  /** Within this many lines */
  within: number;
}

/**
 * Context for where to look for code patterns.
 */
export interface CodePatternContext {
  /** Only match in these function names */
  inFunctions?: string[];

  /** Only match in files matching these patterns */
  inFiles?: string[];

  /** Only match at file level (not in functions) */
  atFileLevel?: boolean;

  /** Only match at function level */
  atFunctionLevel?: boolean;
}

// ============================================================================
// AST Pattern Matching
// ============================================================================

/**
 * AST-based pattern matching for structural code patterns.
 */
export interface ASTPattern {
  /** Type of AST node to match */
  nodeType: ASTNodeType;

  /** Properties the node must have */
  properties?: Record<string, ASTPropertyMatcher>;

  /** Child nodes that must be present */
  children?: ASTPattern[];

  /** Parent node requirements */
  parent?: ASTPattern;

  /** Sibling node requirements */
  siblings?: ASTPattern[];
}

/**
 * Supported AST node types for matching.
 */
export type ASTNodeType =
  | 'FunctionDeclaration'
  | 'ArrowFunction'
  | 'CallExpression'
  | 'MethodDefinition'
  | 'ClassDeclaration'
  | 'VariableDeclaration'
  | 'ExportDeclaration'
  | 'ImportDeclaration'
  | 'Decorator'
  | 'Directive'; // "use server", "use client"

/**
 * Property matcher for AST nodes.
 */
export interface ASTPropertyMatcher {
  /** Exact value match */
  equals?: string | number | boolean;

  /** Pattern match (string contains or regex) */
  matches?: string;

  /** Value must be one of these */
  oneOf?: (string | number | boolean)[];

  /** Property must exist */
  exists?: boolean;

  /** Property must NOT exist */
  notExists?: boolean;
}

// ============================================================================
// Artifact Condition Matching
// ============================================================================

/**
 * Conditions that match against collector artifact output.
 * These leverage the existing extraction data.
 */
export interface ArtifactCondition {
  /** Type of artifact to check */
  type: ArtifactConditionType;

  /** Conditions specific to the type */
  conditions: Record<string, unknown>;
}

/**
 * Types of artifact conditions.
 */
export type ArtifactConditionType =
  | 'service'
  | 'authzCall'
  | 'cacheOperation'
  | 'transactionScope'
  | 'webhookHandler'
  | 'jobHandler'
  | 'membershipMutation'
  | 'test';

/**
 * Service-level artifact conditions.
 */
export interface ServiceCondition extends ArtifactCondition {
  type: 'service';
  conditions: {
    /** Service has this directive (e.g., "use server") */
    hasDirective?: string;
    /** Service is missing auth calls */
    missingAuthCall?: boolean;
    /** Service has certain export patterns */
    exportPattern?: string;
    /** Service mutates data without checks */
    hasMutationWithoutCheck?: boolean;
  };
}

/**
 * Transaction-level artifact conditions.
 */
export interface TransactionCondition extends ArtifactCondition {
  type: 'transactionScope';
  conditions: {
    /** ORM type (prisma, drizzle, etc.) */
    orm?: string;
    /** Transaction contains side effects */
    containsSideEffects?: boolean;
    /** Types of side effects to check for */
    sideEffectTypes?: SideEffectType[];
    /** Transaction lacks isolation level */
    missingIsolation?: boolean;
  };
}

/**
 * Types of side effects that can occur in transactions.
 */
export type SideEffectType =
  | 'email'
  | 'webhook'
  | 'queue'
  | 'external_api'
  | 'file_write'
  | 'cache_write'
  | 'analytics';

/**
 * Webhook handler artifact conditions.
 */
export interface WebhookCondition extends ArtifactCondition {
  type: 'webhookHandler';
  conditions: {
    /** Provider (stripe, clerk, github, etc.) */
    provider?: string;
    /** Missing signature verification */
    missingSignatureVerification?: boolean;
    /** Missing idempotency handling */
    missingIdempotency?: boolean;
    /** Has specific patterns */
    hasPattern?: string;
  };
}

// ============================================================================
// Pattern Finding Output
// ============================================================================

/**
 * What finding to report when a pattern matches.
 */
export interface PatternFinding {
  /** Severity of the finding */
  severity: Severity;

  /** Human-readable message */
  message: string;

  /** What proof is required to resolve this */
  requiredProof: string;

  /** Suggested test code */
  suggestedTest?: string;

  /** Links to documentation */
  references?: string[];

  /** Tags for categorization */
  tags?: string[];
}

// ============================================================================
// Pattern Metadata
// ============================================================================

/**
 * Metadata about the pattern.
 */
export interface PatternMetadata {
  /** Who created this pattern */
  author: string;

  /** When it was created (ISO 8601) */
  created: string;

  /** When it was last updated (ISO 8601) */
  updated?: string;

  /** External references */
  references?: string[];

  /** Related patterns */
  relatedPatterns?: string[];

  /** Accuracy metrics (learned from usage) */
  accuracy?: PatternAccuracy;
}

/**
 * Accuracy metrics for a pattern (learned from calibration data).
 */
export interface PatternAccuracy {
  /** True positive rate (0-1) */
  truePositiveRate: number;

  /** False positive rate (0-1) */
  falsePositiveRate: number;

  /** Number of samples used to calculate */
  sampleCount: number;

  /** Last calculated (ISO 8601) */
  calculatedAt: string;
}

// ============================================================================
// Pattern API Types
// ============================================================================

/**
 * Request to fetch applicable patterns.
 */
export interface PatternFetchRequest {
  /** Detected frameworks in the codebase */
  frameworks: string[];

  /** Framework versions if known */
  frameworkVersions?: Record<string, string>;

  /** Which invariants to get patterns for */
  invariants?: string[];

  /** Client version */
  clientVersion: string;
}

/**
 * Response from pattern fetch.
 */
export interface PatternFetchResponse {
  /** Available patterns */
  patterns: PatternDefinition[];

  /** Metadata about the response */
  meta: {
    /** Total patterns available */
    total: number;

    /** Patterns filtered for this request */
    filtered: number;

    /** Cache information */
    etag: string;

    /** When to refresh */
    maxAge: number;
  };
}

/**
 * Request to find which patterns match an artifact.
 */
export interface PatternMatchRequest {
  /** Summary of the codebase artifact */
  artifact: {
    frameworks: string[];
    frameworkVersions?: Record<string, string>;
    serviceCount: number;
    hasServerActions?: boolean;
    hasApiRoutes?: boolean;
    hasWebhooks?: boolean;
    hasTransactions?: boolean;
  };

  /** Client version */
  clientVersion: string;
}

/**
 * Response from pattern matching.
 */
export interface PatternMatchResponse {
  /** Patterns that definitely apply */
  applicablePatterns: string[];

  /** Patterns that might apply */
  suggestedPatterns: string[];

  /** Patterns that don't apply */
  excludedPatterns: string[];
}

// ============================================================================
// Pattern Configuration
// ============================================================================

/**
 * Configuration for pattern fetching and caching.
 */
export interface PatternConfig {
  /** Enable pattern fetching */
  enabled: boolean;

  /** API endpoint for patterns */
  endpoint: string;

  /** API key (optional, for Pro features) */
  apiKey?: string;

  /** Request timeout in ms */
  timeout: number;

  /** Cache configuration */
  cache?: {
    /** Enable caching */
    enabled: boolean;

    /** Cache TTL in seconds */
    ttl: number;

    /** Cache file path */
    path?: string;
  };

  /** Offline mode - use bundled patterns only */
  offlineMode?: boolean;
}

/**
 * Default pattern configuration.
 */
export const DEFAULT_PATTERN_CONFIG: PatternConfig = {
  enabled: true,
  endpoint: 'https://api.securitychecks.ai/v1/patterns',
  timeout: 5000,
  cache: {
    enabled: true,
    ttl: 86400, // 24 hours
  },
  offlineMode: false,
};

// ============================================================================
// Pattern Cache
// ============================================================================

/**
 * Cached patterns stored locally.
 */
export interface PatternCache {
  /** Cached pattern definitions */
  patterns: PatternDefinition[];

  /** When patterns were fetched */
  fetchedAt: string;

  /** ETag for conditional fetch */
  etag: string;

  /** When cache expires */
  expiresAt: string;

  /** API version used */
  apiVersion: string;
}
