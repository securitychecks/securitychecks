/* eslint-disable max-lines */
/**
 * Core types for SecurityChecks audit engine
 */

// ============================================================================
// Severity & Invariant Types
// ============================================================================

export type Severity = 'P0' | 'P1' | 'P2';

export interface InvariantDefinition {
  id: string;
  name: string;
  description: string;
  severity: Severity;
  category: InvariantCategory;
  requiredProof: string;
  documentationUrl?: string;
}

export type InvariantCategory =
  | 'authz'
  | 'auth'
  | 'revocation'
  | 'webhooks'
  | 'transactions'
  | 'cache'
  | 'billing'
  | 'jobs'
  | 'analytics'
  | 'tests'
  | 'rls'
  | 'dataflow'
  | 'config'
  | 'crypto'
  | 'session'
  | 'business-logic';

// ============================================================================
// Finding Types
// ============================================================================

/** Basic evidence location (for backwards compatibility) */
export interface Evidence {
  file: string;
  line: number;
  column?: number;
  symbol?: string;
  snippet?: string;
  context?: string;
}

/** Structured evidence for P0 findings - makes disputes impossible */
export interface StructuredEvidence {
  /** Human-readable summary of why this is a finding */
  summary: string;
  /** The mutation site (for revocation invariants) */
  mutationSite?: {
    file: string;
    line: number;
    functionName: string;
    mutationType?: string;
    entity?: string;
  };
  /** Where auth decisions read from cache */
  cacheReadSites?: Array<{
    file: string;
    line: number;
    key?: string;
    symbol?: string;
  }>;
  /** Where cache is invalidated (empty = the bug) */
  invalidationSites?: Array<{
    file: string;
    line: number;
    key?: string;
    symbol?: string;
  }>;
  /** Where authz decisions are made */
  authzDecisionSites?: Array<{
    file: string;
    line: number;
    symbol?: string;
  }>;
  /** Tests that cover this invariant */
  testsCovering?: Array<{
    file: string;
    name: string;
    kind: 'unit' | 'integration' | 'e2e';
    confidence: 'immediate' | 'weak';
  }>;
  /** Signals that led to this classification */
  signals?: string[];
  /** Confidence level - P0 requires 'high' */
  confidence: 'high' | 'medium' | 'low';
}

export interface Waiver {
  reason: string;
  expires: string; // ISO date
  by: string;
  createdAt: string; // ISO date
}

export interface Finding {
  invariantId: string;
  severity: Severity;
  message: string;
  /** Basic evidence locations (backwards compatible) */
  evidence: Evidence[];
  /** Structured evidence for high-confidence findings */
  structuredEvidence?: StructuredEvidence;
  requiredProof: string;
  suggestedTest?: string;
  remediation?: string; // Actionable fix guidance
  waived?: Waiver;
  /** Calibration data from API (if enabled) */
  calibration?: FindingCalibration;
  /** Where this finding originated */
  source?: 'cloud' | 'local' | 'local+api';
}

// ============================================================================
// Artifact Types (extracted from target codebase)
// ============================================================================

export interface ServiceEntry {
  file: string;
  name: string;
  exportedFunctions: string[];
  line: number;
}

export interface AuthzCall {
  file: string;
  line: number;
  functionName: string;
  callerFunction?: string;
  arguments?: string[];
}

export interface CacheOperation {
  file: string;
  line: number;
  type: 'get' | 'set' | 'delete' | 'invalidate';
  key?: string;
  callerFunction?: string;
}

export interface TransactionScope {
  file: string;
  line: number;
  endLine: number;
  functionName?: string;
  containsSideEffects: boolean;
  sideEffects: SideEffect[];
  /** Function calls made inside the transaction (for cross-function tracking) */
  functionCalls?: Array<{
    name: string;
    line: number;
  }>;
}

export interface SideEffect {
  type: 'email' | 'webhook' | 'analytics' | 'external_api' | 'queue' | 'unknown';
  file: string;
  line: number;
  description?: string;
}

/** Supported webhook providers */
export type WebhookProvider =
  | 'stripe'
  | 'github'
  | 'slack'
  | 'svix'
  | 'clerk'
  | 'resend'
  | 'paddle'
  | 'lemonsqueezy'
  | 'twilio'
  | 'sendgrid'
  | 'postmark'
  | 'shopify'
  | 'paypal'
  | 'plaid'
  | 'generic';

export interface WebhookHandler {
  file: string;
  line: number;
  provider: WebhookProvider;
  eventTypes?: string[];
  // Idempotency facts
  hasIdempotencyCheck: boolean;
  idempotencyKeyLocation?: string;
  // Event ID extraction
  eventIdExtraction?: {
    method: 'stripe_event_id' | 'github_delivery' | 'svix_id' | 'header' | 'body_field' | 'none';
    location?: string;
  };
  // Persistence marker (where processed IDs are stored)
  persistenceMarker?: {
    type: 'database' | 'cache' | 'none';
    location?: string;
  };
  // Signature verification (Stripe constructEvent, Svix verify, HMAC, etc.)
  signatureVerification?: {
    method:
      | 'stripe_construct_event'
      | 'svix_verify'
      | 'github_signature'
      | 'slack_signature'
      | 'paddle_signature'
      | 'paypal_signature'
      | 'generic_hmac'
      | 'none';
    location?: string;
  };
  // Handler function name (for better error messages)
  handlerName?: string;
  // Partial idempotency detection: which event types have idempotency protection
  eventTypeIdempotency?: Array<{
    eventType: string;
    hasIdempotency: boolean;
    line?: number;
  }>;
}

export interface JobHandler {
  file: string;
  line: number;
  name: string;
  hasIdempotencyCheck: boolean;
  framework?: 'bullmq' | 'inngest' | 'trigger' | 'custom';
}

/**
 * CallGraphNode - Represents a function and its call relationships
 * Used for tracking auth propagation through call chains.
 */
export interface CallGraphNode {
  file: string;
  line: number;
  functionName: string;
  // Functions this function calls
  calls: Array<{
    targetFunction: string;
    targetFile?: string;
    // Original name if aliased (e.g., import { foo as bar } -> originalName: 'foo')
    originalName?: string;
    line: number;
  }>;
  // Functions that call this function
  calledBy?: Array<{
    callerFunction: string;
    callerFile: string;
  }>;
}

/**
 * ImportBinding - Represents a single import statement binding
 */
export interface ImportBinding {
  localName: string;
  originalName: string;
  sourceModule: string;
  resolvedPath?: string;
  type: 'named' | 'default' | 'namespace' | 'commonjs';
}

/**
 * FileImports - All imports in a single file
 */
export interface FileImports {
  file: string;
  imports: ImportBinding[];
}

/**
 * ImportGraph - Cross-file import relationships
 */
export interface ImportGraph {
  files: Map<string, FileImports>;
  exports: Map<string, string[]>;
}

/**
 * CallGraph - Complete call graph of the codebase
 * Note: This uses Maps which don't serialize to JSON.
 * Use SerializableCallGraph for JSON output.
 */
export interface CallGraph {
  nodes: Map<string, CallGraphNode>;
  byName: Map<string, CallGraphNode[]>;
  importGraph: ImportGraph;
}

/**
 * SerializableCallGraph - JSON-friendly version of CallGraph
 * Used in CollectorArtifact for persistence.
 */
export interface SerializableCallGraph {
  nodes: CallGraphNode[];
}

// ============================================================================
// Data Flow Types (Taint Analysis)
// ============================================================================

export type DataFlowSourceType =
  | 'request_body'
  | 'request_params'
  | 'request_query'
  | 'request_headers'
  | 'request_cookies'
  | 'url_param'
  | 'form_data'
  | 'user_input'
  | 'database_result'
  | 'external_api';

export type DataFlowSinkType =
  | 'database_query'
  | 'database_write'
  | 'file_read'
  | 'file_write'
  | 'command_exec'
  | 'eval'
  | 'redirect'
  | 'html_response'
  | 'sql_query'
  | 'nosql_query'
  | 'header_set'
  | 'cookie_set'
  | 'dom_sink';

export type DataFlowTransformType =
  | 'sanitize'
  | 'validate'
  | 'encode'
  | 'parse'
  | 'slice'
  | 'filter'
  | 'unknown';

export interface DataFlowSource {
  file: string;
  line: number;
  type: DataFlowSourceType;
  variable: string;
  functionContext?: string;
  accessPath?: string;
}

export interface DataFlowSink {
  file: string;
  line: number;
  type: DataFlowSinkType;
  functionContext?: string;
  context: string;
  taintedInputs: string[];
}

export interface DataFlowTransform {
  file: string;
  line: number;
  type: DataFlowTransformType;
  inputVariable: string;
  outputVariable?: string;
  functionContext?: string;
  description?: string;
}

export interface DataFlow {
  source: DataFlowSource;
  sink: DataFlowSink;
  transforms: DataFlowTransform[];
  isSanitized: boolean;
  isValidated: boolean;
  isAdminProtected?: boolean; // 2026-01-09: Reduce severity for admin-protected endpoints
  flowPath: string[];
}

export interface DataFlowGraph {
  sources: DataFlowSource[];
  sinks: DataFlowSink[];
  transforms: DataFlowTransform[];
  flows: DataFlow[];
}

/**
 * RouteEntry - HTTP route definitions with service call tracking
 * Used to verify that auth middleware at route level protects service calls.
 */
export interface RouteEntry {
  file: string;
  line: number;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL' | 'OPTIONS' | 'HEAD';
  path?: string;
  handlerName?: string;
  // Auth detection
  hasAuthMiddleware: boolean;
  authMiddleware?: string[];
  // Service calls made by this route
  serviceCalls: Array<{
    serviceName: string;
    functionName: string;
    line: number;
  }>;
  // Framework detection
  framework:
    | 'express'
    | 'fastify'
    | 'nextjs'
    | 'trpc'
    | 'nestjs'
    | 'hono'
    | 'sveltekit'
    | 'nuxt'
    | 'qwik'
    | 'astro'
    | 'solid-start'
    | 'keystone'
    | 'remix'
    | 'koa'
    | 'hapi'
    | 'elysia'
    | 'nitro'
    | 'vinxi'
    | 'unknown';
}

/**
 * MembershipMutation - sites where membership/role is changed
 * Used to detect if cache is properly invalidated on auth changes.
 */
export interface MembershipMutation {
  file: string;
  line: number;
  functionName: string;
  mutationType: 'remove' | 'downgrade' | 'revoke' | 'update';
  // What entity is being mutated
  entity: 'member' | 'role' | 'permission' | 'apiKey' | 'session' | 'team' | 'generic';
  // Cache invalidation detected in same function
  hasCacheInvalidation: boolean;
  invalidationLocation?: string;
  // Related cache key patterns (if detected)
  relatedCacheKeys?: string[];
  // Signals explaining WHY this was classified (for defensibility)
  signals: string[];
  // Confidence level based on signal strength
  confidence: 'high' | 'medium' | 'low';
}

export interface TestEntry {
  file: string;
  line: number;
  name: string;
  type: 'unit' | 'integration' | 'e2e';
  describes?: string[];
  assertions: AssertionInfo[];
  antiPatterns: TestAntiPattern[];
}

export interface AssertionInfo {
  line: number;
  type: 'status' | 'body' | 'database' | 'side_effect' | 'error' | 'unknown';
  isPermissive: boolean; // e.g., expects 200 || 201
}

export interface TestAntiPattern {
  type:
    | 'sleep'
    | 'silent_skip'
    | 'permissive_assertion'
    | 'mocked_sut'
    | 'no_cleanup'
    | 'no_assertions'
    | 'always_passes'
    | 'error_swallowing';
  line: number;
  description: string;
}

// ============================================================================
// Full Artifact (output of extraction)
// ============================================================================

/** @deprecated Use CollectorArtifact instead */
export interface Artifact {
  version: '1.0';
  extractedAt: string; // ISO date
  targetPath: string;

  services: ServiceEntry[];
  authzCalls: AuthzCall[];
  cacheOperations: CacheOperation[];
  transactionScopes: TransactionScope[];
  webhookHandlers: WebhookHandler[];
  jobHandlers: JobHandler[];
  membershipMutations: MembershipMutation[];
  tests: TestEntry[];
  routes: RouteEntry[];
  dataFlows?: DataFlowGraph;
  callGraph?: SerializableCallGraph;
  rlsArtifact?: RLSArtifact;
}

/** Type alias for compatibility with CLI (checkers use Artifact) */
export type CodeArtifact = Omit<Artifact, 'version' | 'extractedAt' | 'targetPath'>;

// ============================================================================
// Collector Artifact (new versioned schema)
// ============================================================================

export type CollectorProfile = 'securitychecks' | 'trackstack' | 'all';

/**
 * CollectorArtifact - The output of `scc collect`
 *
 * This is the versioned artifact schema that products consume.
 * The collector emits facts. Products interpret facts.
 */
export interface CollectorArtifact {
  // Metadata (always present)
  version: '1.0';
  /**
   * Schema version (semver). Used by consumers to check compatibility.
   * If missing, assume "1.0.0" (pre-versioning artifacts).
   */
  schemaVersion: string;
  profile: CollectorProfile;
  extractedAt: string; // ISO date
  codebase: {
    root: string;
    filesScanned: number;
    languages: string[];
    frameworks?: string[];
    frameworkVersions?: Record<string, string>;
    partitions?: Array<{
      relativePath: string;
      kind: 'workspace' | 'root' | 'app' | 'package';
      frameworks: string[];
      frameworkVersions?: Record<string, string>;
      effectiveFrameworks?: string[];
    }>;
  };

  // === CORE (shared by all profiles) ===
  services: ServiceEntry[];

  // === SECURITYCHECKS PROFILE ===
  authzCalls?: AuthzCall[];
  cacheOperations?: CacheOperation[];
  transactionScopes?: TransactionScope[];
  webhookHandlers?: WebhookHandler[];
  jobHandlers?: JobHandler[];
  membershipMutations?: MembershipMutation[];
  tests?: TestEntry[];
  routes?: RouteEntry[];
  dataFlows?: DataFlowGraph;
  callGraph?: SerializableCallGraph;
  rlsArtifact?: RLSArtifact;

  // === TRACKSTACK PROFILE (future) ===
  // packages?: PackageEntry[];
  // packageUsage?: PackageUsage[];
  // dependencyGraph?: DependencyGraph;
}

// ============================================================================
// Baseline Types
// ============================================================================

export interface BaselineEntry {
  invariantId: string;
  evidence: Evidence[];
  createdAt: string; // ISO date
  waiver?: Waiver;
}

export interface Baseline {
  version: '1.0';
  createdAt: string;
  updatedAt: string;
  entries: BaselineEntry[];
}

// ============================================================================
// Config Types
// ============================================================================

export interface PartitionOverride {
  // Path relative to repo root, ex: "apps/web"
  path: string;
  include?: string[];
  exclude?: string[];
  servicePatterns?: string[];
  testPatterns?: string[];
}

export interface AuditConfig {
  version: '1.0';

  // Paths to scan
  include: string[];
  exclude: string[];

  // Test file patterns
  testPatterns: string[];

  // Service file patterns (where authz should be enforced)
  servicePatterns: string[];

  // Enabled invariants (default: all)
  enabledInvariants?: string[];
  disabledInvariants?: string[];

  // Custom patterns for detection
  authzFunctions?: string[];
  cachePatterns?: {
    get?: string[];
    set?: string[];
    delete?: string[];
  };

  // Webhook providers to detect
  webhookProviders?: string[];

  // Job frameworks to detect
  jobFrameworks?: string[];

  // Test file handling for non-test extractors
  testFileHandling?: {
    mode?: 'exclude' | 'include';
    strategy?: 'path' | 'heuristic' | 'both';
  };

  // Partitioning settings (monorepo-aware scanning)
  partitioning?: {
    enabled?: boolean;
  };

  // Partition-specific overrides (relative to repo root)
  partitionOverrides?: PartitionOverride[];

  // Generated file handling for file inventory
  generatedFileHandling?: {
    mode?: 'exclude' | 'include';
    strategy?: 'path' | 'header' | 'both';
  };

  // Dataflow extractor settings
  dataflow?: {
    maxFileBytes?: number;
    maxFileLines?: number;
  };

  // Calibration API settings (optional, advisory)
  calibration?: CalibrationConfig;
}

// ============================================================================
// Calibration API Types (Protected IP - "The SaaS advises, local tool decides")
// ============================================================================

/**
 * Configuration for the Calibration API
 * The API refines confidence but never makes pass/fail decisions.
 */
export interface CalibrationConfig {
  /** Enable calibration API calls (default: true) */
  enabled: boolean;

  /** API endpoint URL */
  endpoint: string;

  /** API key for authentication (via env: SECURITYCHECKS_API_KEY) */
  apiKey?: string;

  /** Request timeout in ms (default: 2000) */
  timeout: number;

  /** Minimum confidence to apply API suggestions (default: 0.85) */
  minConfidence: number;

  /** Cache settings for API responses */
  cache?: {
    enabled: boolean;
    ttl: number; // seconds
    path?: string; // default: .securitychecks/calibration-cache.json
  };
}

/**
 * What we send to the Calibration API (privacy-safe, no source code)
 */
export interface CalibrationRequest {
  /** Which invariant this finding is for */
  invariantId: string;

  /** What the local checker determined */
  localSeverity: Severity;

  /** Pattern metadata (no code) */
  pattern: {
    /** Function name where finding was detected */
    functionName?: string;
    /** Type of mutation (for revocation checks) */
    mutationType?: string;
    /** Entity type (member, apiKey, etc.) */
    entity?: string;
    /** Pattern signals detected */
    signals?: string[];
    /** Local confidence level */
    confidence?: 'high' | 'medium' | 'low';
    /** Specific pattern indicators */
    indicators?: {
      hasIdempotencyKey?: boolean;
      hasPersistence?: boolean;
      hasCacheInvalidation?: boolean;
      hasTests?: boolean;
      hasAuthMiddleware?: boolean;
    };
  };

  /** Anonymized codebase context */
  context: {
    /** Detected framework (nextjs, express, etc.) */
    framework?: string;
    /** Number of services in codebase */
    serviceCount?: number;
    /** How many findings of this type */
    findingCount?: number;
    /** Whether codebase has tests */
    hasTests?: boolean;
  };

  /** Request metadata */
  meta: {
    /** CLI version */
    clientVersion: string;
    /** Unique request ID for deduplication */
    requestId: string;
    /** Timestamp */
    timestamp: string;
  };
}

/**
 * What the Calibration API returns
 */
export interface CalibrationResponse {
  /** API's recommended severity (may differ from local) */
  recommendedSeverity: Severity;

  /** How confident the API is (0.0-1.0) */
  confidence: number;

  /** Why the API made this recommendation */
  reasoning?: string;

  /** Known pattern name if recognized */
  knownPattern?: string;

  /** Whether this finding should be suppressed entirely */
  suppress?: boolean;

  /** Additional context */
  meta?: {
    /** How many similar patterns the API has seen */
    patternCount?: number;
    /** False positive rate for this pattern */
    falsePositiveRate?: number;
  };
}

/**
 * Calibration data attached to a Finding
 */
export interface FindingCalibration {
  /** What the API recommended */
  apiRecommendation: CalibrationResponse;

  /** Whether the recommendation was applied */
  applied: boolean;

  /** Original severity before calibration */
  originalSeverity: Severity;

  /** Why it was or wasn't applied */
  reason?: string;
}

// ============================================================================
// Check Result Types
// ============================================================================

export interface CheckResult {
  invariantId: string;
  passed: boolean;
  findings: Finding[];
  checkedAt: string;
  duration: number; // ms
}

export interface AuditResult {
  version: '1.0';
  targetPath: string;
  runAt: string;
  duration: number;

  summary: {
    total: number;
    passed: number;
    failed: number;
    waived: number;
    byPriority: {
      P0: number;
      P1: number;
      P2: number;
    };
  };

  results: CheckResult[];
  artifact: Artifact;
}

// ============================================================================
// Checker Interface
// ============================================================================

export interface Checker {
  invariant: InvariantDefinition;
  check(artifact: Artifact, config: AuditConfig): Promise<CheckResult>;
}

// ============================================================================
// RLS (Row Level Security) Types
// ============================================================================

/** Tenant column patterns commonly used in multi-tenant apps */
export type TenantPattern =
  | 'organization'
  | 'tenant'
  | 'team'
  | 'workspace'
  | 'account'
  | 'company'
  | 'user'
  | 'unknown';

/** Database/ORM framework detected */
export type DatabaseFramework =
  | 'prisma'
  | 'drizzle'
  | 'supabase'
  | 'typeorm'
  | 'sequelize'
  | 'raw_sql'
  | 'unknown';

/**
 * RLSPolicy - A detected Row Level Security policy
 */
export interface RLSPolicy {
  file: string;
  line: number;
  /** Table this policy applies to */
  table: string;
  /** Policy name (if identifiable) */
  policyName?: string;
  /** Policy type */
  policyType: 'using' | 'with_check' | 'both';
  /** Column used for tenant filtering */
  tenantColumn?: string;
  /** Whether policy uses session context (current_setting, auth.uid, etc.) */
  usesSessionContext: boolean;
  /** The session context pattern (e.g., current_setting('app.org_id')) */
  sessionContextPattern?: string;
  /** Operations covered by this policy */
  operations?: Array<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'>;
}

/**
 * MultiTenantTable - A table with multi-tenant characteristics
 */
export interface MultiTenantTable {
  file: string;
  line: number;
  /** Table/model name */
  table: string;
  /** Column used for tenant isolation */
  tenantColumn: string;
  /** Type of tenant pattern detected */
  tenantPattern: TenantPattern;
  /** Whether this table has RLS policies */
  hasRLSPolicy: boolean;
  /** Whether queries to this table include tenant filtering */
  hasQueryFiltering: boolean;
  /** Related tables via foreign keys (for indirect RLS) */
  relatedTables?: string[];
  /** Framework where this was detected */
  framework: DatabaseFramework;
}

/**
 * DatabaseQuery - A detected database query that may need tenant filtering
 */
export interface DatabaseQuery {
  file: string;
  line: number;
  /** Table being queried */
  table: string;
  /** Query operation type */
  operation: 'select' | 'insert' | 'update' | 'delete';
  /** Whether query includes tenant filtering */
  hasTenantFilter: boolean;
  /** The tenant filter expression if present */
  tenantFilterExpression?: string;
  /** Function containing this query */
  containingFunction?: string;
  /** Framework used for query */
  framework: DatabaseFramework;
}

/**
 * RLSArtifact - Complete RLS analysis of a codebase
 */
export interface RLSArtifact {
  /** Detected multi-tenant tables/models */
  multiTenantTables: MultiTenantTable[];
  /** Detected RLS policies (from migrations, schema) */
  rlsPolicies: RLSPolicy[];
  /** Database queries that may need tenant filtering */
  queries: DatabaseQuery[];
  /** Primary database framework detected */
  framework: DatabaseFramework;
  /** Whether Supabase client is used (implies RLS should be present) */
  usesSupabase: boolean;
  /** Whether RLS context helper pattern is detected */
  hasRLSContextHelper: boolean;
}

// ============================================================================
// Extractor Interface
// ============================================================================

export interface ExtractorOptions {
  targetPath: string;
  config: AuditConfig;
}

export interface Extractor<T> {
  name: string;
  extract(options: ExtractorOptions): Promise<T[]>;
}
