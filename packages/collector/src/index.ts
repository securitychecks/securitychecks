/**
 * @securitychecks/collector
 *
 * Code artifact collector - extracts facts from codebases.
 * No opinions, no policy, no enforcement.
 *
 * "The collector emits facts. Products interpret facts. Policy never lives in the collector."
 */

// Types
export * from './types.js';

// Pattern types (Pro Patterns)
export * from './patterns.js';

// Schema version (for consumer compatibility checks)
export { ARTIFACT_SCHEMA_VERSION } from './schema/index.js';

// Configuration
export { loadConfig, DEFAULT_CONFIG, resolveTargetPath } from './config.js';

// File inventory helpers
export * from './files/index.js';

// Artifact size utilities (for metrics and logging)
export {
  getArtifactSize,
  getArtifactSizeFormatted,
  getArtifactStats,
} from './chunking.js';

// Extractors
export {
  extractAll,
  extractServices,
  extractAuthzCalls,
  extractTests,
  extractWebhooks,
  extractTransactions,
  extractCacheOperations,
  isAuthRelatedCache,
  extractRoutes,
  extractDataFlows,
} from './extractors/index.js';

// Invariant definitions (data, not policy)
export {
  ALL_INVARIANTS,
  P0_INVARIANTS,
  P1_INVARIANTS,
  getInvariantById,
  getInvariantsByCategory,
  // P0 - Critical
  AUTHZ_SERVICE_LAYER_ENFORCED,
  AUTHZ_MEMBERSHIP_REVOCATION_IMMEDIATE,
  AUTHZ_KEYS_REVOCATION_IMMEDIATE,
  AUTHZ_RLS_MULTI_TENANT,
  AUTHZ_TENANT_ISOLATION,
  WEBHOOK_IDEMPOTENT,
  WEBHOOK_SIGNATURE_VERIFIED,
  TRANSACTION_POST_COMMIT_SIDE_EFFECTS,
  DATAFLOW_UNTRUSTED_SQL_QUERY,
  DATAFLOW_UNTRUSTED_COMMAND_EXEC,
  CORS_CREDENTIALS_WILDCARD,
  JWT_WEAK_VERIFICATION,
  XSS_DOM_SINK,
  NOSQL_INJECTION,
  DESERIALIZATION_UNSAFE,
  PROTOTYPE_POLLUTION,
  EVAL_USER_INPUT,
  // P1 - Important
  CACHE_INVALIDATION_ON_AUTH_CHANGE,
  JOBS_RETRY_SAFE,
  BILLING_SERVER_ENFORCED,
  ANALYTICS_SCHEMA_STABLE,
  TESTS_NO_FALSE_CONFIDENCE,
  DATAFLOW_UNTRUSTED_FILE_ACCESS,
  DATAFLOW_UNTRUSTED_RESPONSE,
  CORS_WILDCARD_ORIGIN,
  CRYPTO_WEAK_ALGORITHM,
  CRYPTO_INSECURE_RANDOM,
  LOGGING_SENSITIVE_DATA,
  JWT_NO_EXPIRY,
  GRAPHQL_NO_DEPTH_LIMIT,
  RATE_LIMIT_MISSING,
  DEBUG_ENDPOINTS_EXPOSED,
  XSS_TEMPLATE_INJECTION,
  HEADER_INJECTION,
  OPEN_REDIRECT,
  REGEX_DOS,
  SESSION_NO_HTTPONLY,
  SESSION_NO_SECURE,
  SESSION_NO_SAMESITE,
  SESSION_FIXATION,
  // Phase 2 - Extended Dataflow Sinks
  LDAP_INJECTION,
  XML_INJECTION,
  XXE_EXTERNAL_ENTITY,
  SSTI_INJECTION,
  GRAPHQL_QUERY_INJECTION,
  ORM_RAW_QUERY,
  SHELL_EXPANSION,
  SSRF_URL,
  LOG_INJECTION,
  EMAIL_HEADER_INJECTION,
  PDF_INJECTION,
  CSV_INJECTION,
  // Phase 3 - Authorization Deep Analysis
  IDOR_SEQUENTIAL_ID,
  IDOR_UUID_NO_AUTH,
  ROLE_ESCALATION_SELF,
  ADMIN_NO_ROLE_CHECK,
  MIDDLEWARE_ORDER_BYPASS,
  OPTIONAL_AUTH_DATA_LEAK,
  GRAPHQL_FIELD_NO_AUTH,
  TRPC_PUBLIC_MUTATION,
  NEXTJS_API_UNPROTECTED,
  EXPRESS_ROUTE_NO_AUTH,
  PERMISSION_CHECK_CACHED,
  OWNERSHIP_NOT_VERIFIED,
  SOFT_DELETE_BYPASS,
  // Phase 4 - Business Logic
  PAYMENT_NO_IDEMPOTENCY,
  PAYMENT_CLIENT_AMOUNT,
  RACE_CONDITION_BALANCE,
  RACE_CONDITION_INVENTORY,
  STATE_MACHINE_SKIP,
  FEATURE_FLAG_CLIENT,
  TRIAL_BYPASS,
  RATE_LIMIT_BYPASS,
  EMAIL_VERIFICATION_SKIP,
  MFA_BYPASS,
  INVITE_TOKEN_REUSE,
  PASSWORD_RESET_NO_EXPIRE,
  // Phase 5 - Framework-Specific
  NEXTJS_SSR_SECRET_LEAK,
  NEXTJS_MIDDLEWARE_BYPASS,
  NEXTJS_ISR_REVALIDATE_AUTH,
  REACT_DANGEROUSLY_SET_USER_DATA,
  PRISMA_RAW_INTERPOLATION,
  PRISMA_SELECT_ALL_EXPOSURE,
  TRPC_ERROR_LEAK,
  EXPRESS_TRUST_PROXY,
  EXPRESS_STATIC_DOTFILES,
  SOCKETIO_NO_AUTH,
  GRAPHQL_BATCHING_DOS,
  APOLLO_PERSISTED_BYPASS,
  REMIX_LOADER_NO_AUTH,
  // Phase 6 - Crypto & Secrets
  CRYPTO_ECB_MODE,
  CRYPTO_STATIC_IV,
  CRYPTO_WEAK_KEY,
  TIMING_ATTACK_COMPARISON,
  JWT_NONE_ALGORITHM,
  JWT_WEAK_SECRET,
  PASSWORD_PLAINTEXT_STORE,
  PASSWORD_WEAK_HASH,
  SECRET_IN_ERROR,
  KEY_DERIVATION_WEAK,
  // P2 - Informational
  GRAPHQL_INTROSPECTION_ENABLED,
} from './invariants.js';

// ============================================================================
// Profile System
// ============================================================================

export type CollectorProfile = 'securitychecks' | 'trackstack' | 'all';

export interface ProfileConfig {
  name: string;
  extractors: string[];
  description: string;
}

export const PROFILES: Record<CollectorProfile, ProfileConfig> = {
  securitychecks: {
    name: 'securitychecks',
    extractors: ['services', 'authz', 'cache', 'transactions', 'webhooks', 'jobs', 'tests', 'dataflow'],
    description: 'Security invariant checking (for scheck)',
  },
  trackstack: {
    name: 'trackstack',
    extractors: ['services', 'imports', 'packages'],
    description: 'Package intelligence (for TrackStack)',
  },
  all: {
    name: 'all',
    extractors: [
      'services',
      'authz',
      'cache',
      'transactions',
      'webhooks',
      'jobs',
      'tests',
      'dataflow',
      'imports',
      'packages',
    ],
    description: 'Full extraction (all facts)',
  },
};

// ============================================================================
// Main Collect Function
// ============================================================================

import type { CollectorArtifact, AuditConfig } from './types.js';
import { ARTIFACT_SCHEMA_VERSION } from './schema/index.js';
import { loadConfig, resolveTargetPath } from './config.js';
import { detectFrameworkContext } from './frameworks/context.js';
import { extractAll } from './extractors/index.js';

export interface CollectOptions {
  targetPath?: string;
  profile?: CollectorProfile;
  config?: Partial<AuditConfig>;
}

/**
 * Sort entries deterministically by file path, then line number.
 * This ensures stable output for CI, caching, and diffs.
 */
function sortByFileLine<T extends { file: string; line: number }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) return fileCompare;
    return a.line - b.line;
  });
}

/**
 * Collect code artifacts from target codebase
 *
 * @example
 * ```ts
 * const artifact = await collect({
 *   targetPath: '/path/to/codebase',
 *   profile: 'securitychecks',
 * });
 * ```
 */
export async function collect(options: CollectOptions = {}): Promise<CollectorArtifact> {
  const targetPath = resolveTargetPath(options.targetPath);
  const profile = options.profile ?? 'securitychecks';

  // Load config
  const baseConfig = await loadConfig(targetPath);
  const config: AuditConfig = {
    ...baseConfig,
    ...options.config,
  };
  const frameworkContext = await detectFrameworkContext(targetPath);

  // Extract artifacts
  const rawArtifact = await extractAll({ targetPath, config });

  // Sort all arrays deterministically for stable output
  const services = sortByFileLine(rawArtifact.services);
  const authzCalls = rawArtifact.authzCalls ? sortByFileLine(rawArtifact.authzCalls) : undefined;
  const cacheOperations = rawArtifact.cacheOperations ? sortByFileLine(rawArtifact.cacheOperations) : undefined;
  const transactionScopes = rawArtifact.transactionScopes ? sortByFileLine(rawArtifact.transactionScopes) : undefined;
  const webhookHandlers = rawArtifact.webhookHandlers ? sortByFileLine(rawArtifact.webhookHandlers) : undefined;
  const jobHandlers = rawArtifact.jobHandlers ? sortByFileLine(rawArtifact.jobHandlers) : undefined;
  const membershipMutations = rawArtifact.membershipMutations ? sortByFileLine(rawArtifact.membershipMutations) : undefined;
  const tests = rawArtifact.tests ? sortByFileLine(rawArtifact.tests) : undefined;
  const routes = rawArtifact.routes ? sortByFileLine(rawArtifact.routes) : undefined;
  const dataFlows = rawArtifact.dataFlows
    ? {
        sources: sortByFileLine(rawArtifact.dataFlows.sources),
        sinks: sortByFileLine(rawArtifact.dataFlows.sinks),
        transforms: sortByFileLine(rawArtifact.dataFlows.transforms),
        flows: [...rawArtifact.dataFlows.flows].sort((a, b) => {
          const sourceFileCompare = a.source.file.localeCompare(b.source.file);
          if (sourceFileCompare !== 0) return sourceFileCompare;
          return a.source.line - b.source.line;
        }),
      }
    : undefined;
  const callGraph = rawArtifact.callGraph ? {
    nodes: sortByFileLine(rawArtifact.callGraph.nodes),
  } : undefined;
  const rlsArtifact = rawArtifact.rlsArtifact;

  // Return collector artifact with profile metadata
  return {
    version: '1.0',
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    profile,
    extractedAt: new Date().toISOString(),
    codebase: {
      root: targetPath,
      filesScanned: countFiles(rawArtifact),
      languages: detectLanguages(rawArtifact).sort(), // Sort languages too
      frameworks: frameworkContext.frameworks,
      frameworkVersions: frameworkContext.frameworkVersions,
      partitions: frameworkContext.partitions.map((partition) => ({
        relativePath: partition.relativePath,
        kind: partition.kind,
        frameworks: partition.frameworks,
        frameworkVersions: partition.frameworkVersions,
        effectiveFrameworks: partition.effectiveFrameworks,
      })),
    },
    // Core (always present)
    services,
    // SecurityChecks profile
    authzCalls,
    cacheOperations,
    transactionScopes,
    webhookHandlers,
    jobHandlers,
    membershipMutations,
    tests,
    routes,
    dataFlows,
    callGraph,
    rlsArtifact,
    // TrackStack profile (TODO: implement)
    // packages: [],
    // packageUsage: [],
    // dependencyGraph: undefined,
  };
}

function countFiles(artifact: { services: { file: string }[] }): number {
  const files = new Set<string>();
  for (const service of artifact.services) {
    files.add(service.file);
  }
  return files.size;
}

function detectLanguages(artifact: { services: { file: string }[] }): string[] {
  const extensions = new Set<string>();
  for (const service of artifact.services) {
    const ext = service.file.split('.').pop();
    if (ext) extensions.add(ext);
  }

  const languages: string[] = [];
  if (extensions.has('ts') || extensions.has('tsx')) languages.push('typescript');
  if (extensions.has('js') || extensions.has('jsx')) languages.push('javascript');

  return languages;
}

// NOTE: Checkers have been moved to @securitychecks/cli
// The collector emits facts. Products interpret facts. Policy never lives in the collector.
