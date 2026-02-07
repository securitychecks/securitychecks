/**
 * Finding Correlation Engine
 *
 * Correlates findings across invariants to detect compounding risks.
 * Multiple findings on the same code path often compound each other,
 * creating worse outcomes than the sum of their parts.
 *
 * Key concepts:
 * - Correlated findings: Multiple findings sharing a code path
 * - Compounding risk: Combined severity is higher than individual
 * - Attack path: Narrative of how findings chain together
 *
 * Example:
 *   Route: POST /api/webhooks/stripe
 *   ├── WEBHOOK.IDEMPOTENT: ✗ No idempotency check
 *   ├── TRANSACTION.POST_COMMIT: ✗ Email inside transaction
 *   └── Combined: If replayed, sends duplicate emails AND inconsistent DB
 */

import type {
  Finding,
  Severity,
  CheckResult,
  Artifact,
  CallGraphNode,
} from '@securitychecks/collector';

// ============================================================================
// Types
// ============================================================================

export interface CorrelatedFinding {
  /** The primary finding (highest severity) */
  primary: Finding;
  /** Related findings on the same code path */
  related: Finding[];
  /** Shared context between findings */
  sharedContext: SharedContext;
  /** How the findings compound each other */
  compoundingEffect: CompoundingEffect;
  /** Adjusted severity based on correlation */
  adjustedSeverity: Severity;
  /** Attack path narrative */
  attackPath?: AttackPath;
}

export interface SharedContext {
  /** Common file */
  file?: string;
  /** Common function */
  functionName?: string;
  /** Common route (if applicable) */
  route?: string;
  /** Shared call chain */
  callChain?: string[];
  /** Number of findings in this correlation */
  findingCount: number;
}

export interface CompoundingEffect {
  /** Description of how findings compound */
  description: string;
  /** Risk multiplier (1.0 = no change, 2.0 = double risk) */
  riskMultiplier: number;
  /** Signals explaining the compounding */
  signals: string[];
}

export interface AttackPath {
  /** Title of the attack path */
  title: string;
  /** Step-by-step narrative */
  steps: AttackStep[];
  /** Overall exploitability */
  exploitability: 'easy' | 'medium' | 'hard';
  /** Impact level */
  impact: 'low' | 'medium' | 'high' | 'critical';
  /** Time window (if applicable) */
  timeWindow?: string;
}

export interface AttackStep {
  /** Step number */
  step: number;
  /** Description of this step */
  description: string;
  /** Which finding enables this step */
  invariantId: string;
  /** File/line reference */
  location?: { file: string; line: number };
}

export interface CorrelationResult {
  /** All correlated finding groups */
  correlations: CorrelatedFinding[];
  /** Statistics */
  stats: {
    totalFindings: number;
    correlatedFindings: number;
    correlationGroups: number;
    severityEscalations: number;
  };
}

// ============================================================================
// Compounding Rules
// ============================================================================

/**
 * Rules for how finding combinations compound
 */
const COMPOUNDING_RULES: Array<{
  invariants: string[];
  effect: CompoundingEffect;
  attackPathTemplate?: Omit<AttackPath, 'steps'>;
}> = [
  // Webhook + Transaction = Replay causes inconsistent state
  {
    invariants: ['WEBHOOK.IDEMPOTENT', 'TRANSACTION.POST_COMMIT.SIDE_EFFECTS'],
    effect: {
      description: 'Webhook replay can cause duplicate side effects AND inconsistent database state',
      riskMultiplier: 2.0,
      signals: ['webhook_replay', 'transaction_side_effect', 'data_inconsistency'],
    },
    attackPathTemplate: {
      title: 'Webhook Replay Attack with Data Inconsistency',
      exploitability: 'easy',
      impact: 'high',
      timeWindow: 'Immediate - no time limit on replay',
    },
  },

  // No auth + No service auth = Complete bypass
  {
    invariants: ['AUTHZ.SERVICE_LAYER.ENFORCED', 'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE'],
    effect: {
      description: 'Missing service-layer auth combined with delayed revocation allows extended unauthorized access',
      riskMultiplier: 2.5,
      signals: ['auth_bypass', 'delayed_revocation', 'privilege_persistence'],
    },
    attackPathTemplate: {
      title: 'Extended Privilege Persistence',
      exploitability: 'medium',
      impact: 'critical',
      timeWindow: 'Until cache expires or session timeout',
    },
  },

  // Cache + Membership revocation = Stale permissions
  {
    invariants: ['CACHE.INVALIDATION.ON_AUTH_CHANGE', 'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE'],
    effect: {
      description: 'Membership change without cache invalidation allows continued access via stale cache',
      riskMultiplier: 2.0,
      signals: ['stale_cache', 'permission_leak', 'revocation_bypass'],
    },
    attackPathTemplate: {
      title: 'Stale Permission Cache Exploit',
      exploitability: 'medium',
      impact: 'high',
      timeWindow: 'Cache TTL (often 5-15 minutes)',
    },
  },

  // Transaction + Cache = Inconsistent read after rollback
  {
    invariants: ['TRANSACTION.POST_COMMIT.SIDE_EFFECTS', 'CACHE.INVALIDATION.ON_AUTH_CHANGE'],
    effect: {
      description: 'Side effect in transaction + missing cache invalidation can leave cache inconsistent after rollback',
      riskMultiplier: 1.5,
      signals: ['rollback_inconsistency', 'cache_stale', 'side_effect_mismatch'],
    },
  },

  // Billing + Auth = Free tier bypass
  {
    invariants: ['BILLING.SERVER_ENFORCED', 'AUTHZ.SERVICE_LAYER.ENFORCED'],
    effect: {
      description: 'Missing billing enforcement + auth gap allows access to paid features without payment',
      riskMultiplier: 2.0,
      signals: ['billing_bypass', 'feature_theft', 'revenue_loss'],
    },
    attackPathTemplate: {
      title: 'Billing Bypass via Auth Gap',
      exploitability: 'medium',
      impact: 'high',
    },
  },

  // Jobs + Transaction = Retry causes duplicate side effects
  {
    invariants: ['JOBS.RETRY_SAFE', 'TRANSACTION.POST_COMMIT.SIDE_EFFECTS'],
    effect: {
      description: 'Non-idempotent job with side effects in transaction can cause duplicates on retry',
      riskMultiplier: 1.8,
      signals: ['job_retry', 'duplicate_side_effect', 'data_duplication'],
    },
  },

  // API Key + Cache = Revoked key still works
  {
    invariants: ['AUTHZ.KEYS.REVOCATION.IMMEDIATE', 'CACHE.INVALIDATION.ON_AUTH_CHANGE'],
    effect: {
      description: 'API key revocation without cache invalidation allows continued API access',
      riskMultiplier: 2.0,
      signals: ['key_still_valid', 'cache_bypass', 'api_access_leak'],
    },
    attackPathTemplate: {
      title: 'API Key Revocation Bypass',
      exploitability: 'easy',
      impact: 'high',
      timeWindow: 'Until cache expires',
    },
  },
];

// ============================================================================
// Main Correlation Function
// ============================================================================

/**
 * Correlate findings to detect compounding risks
 */
export function correlateFindings(
  results: CheckResult[],
  artifact: Artifact
): CorrelationResult {
  // Flatten all findings
  const allFindings = results.flatMap(r => r.findings);

  if (allFindings.length === 0) {
    return {
      correlations: [],
      stats: {
        totalFindings: 0,
        correlatedFindings: 0,
        correlationGroups: 0,
        severityEscalations: 0,
      },
    };
  }

  // Group findings by location
  const groups = groupFindingsByLocation(allFindings);

  // Find correlations
  const correlations: CorrelatedFinding[] = [];
  let severityEscalations = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Check if this group matches any compounding rules
    const correlation = findCorrelation(group, artifact);
    if (correlation) {
      correlations.push(correlation);
      if (severityToNumber(correlation.adjustedSeverity) > severityToNumber(correlation.primary.severity)) {
        severityEscalations++;
      }
    }
  }

  // Count correlated findings
  const correlatedFindingIds = new Set<string>();
  for (const c of correlations) {
    correlatedFindingIds.add(findingId(c.primary));
    for (const r of c.related) {
      correlatedFindingIds.add(findingId(r));
    }
  }

  return {
    correlations,
    stats: {
      totalFindings: allFindings.length,
      correlatedFindings: correlatedFindingIds.size,
      correlationGroups: correlations.length,
      severityEscalations,
    },
  };
}

// ============================================================================
// Grouping Logic
// ============================================================================

/**
 * Group findings by their location (file + function)
 */
function groupFindingsByLocation(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    // Get location key from evidence
    const evidence = finding.evidence[0];
    if (!evidence) continue;

    const key = `${evidence.file}:${evidence.symbol ?? 'unknown'}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(finding);
  }

  return groups;
}

/**
 * Find correlation for a group of findings
 */
function findCorrelation(
  findings: Finding[],
  artifact: Artifact
): CorrelatedFinding | null {
  // Get invariant IDs in this group
  const invariantIds = new Set(findings.map(f => f.invariantId));

  // Find matching compounding rule
  let bestMatch: (typeof COMPOUNDING_RULES)[0] | null = null;
  let matchCount = 0;

  for (const rule of COMPOUNDING_RULES) {
    const matches = rule.invariants.filter(inv => invariantIds.has(inv));
    if (matches.length >= 2 && matches.length > matchCount) {
      bestMatch = rule;
      matchCount = matches.length;
    }
  }

  if (!bestMatch) {
    // No specific rule, but still correlate if multiple findings
    if (findings.length >= 2) {
      return createGenericCorrelation(findings);
    }
    return null;
  }

  // Find the matching findings
  const matchingFindings = findings.filter(f =>
    bestMatch!.invariants.includes(f.invariantId)
  );

  // Sort by severity (P0 first)
  matchingFindings.sort((a, b) =>
    severityToNumber(b.severity) - severityToNumber(a.severity)
  );

  const primary = matchingFindings[0]!;
  const related = matchingFindings.slice(1);

  // Build shared context
  const evidence = primary.evidence[0];
  const sharedContext: SharedContext = {
    file: evidence?.file,
    functionName: evidence?.symbol,
    findingCount: matchingFindings.length,
  };

  // Calculate adjusted severity
  const adjustedSeverity = calculateAdjustedSeverity(
    primary.severity,
    bestMatch.effect.riskMultiplier
  );

  // Build attack path if template exists
  let attackPath: AttackPath | undefined;
  if (bestMatch.attackPathTemplate) {
    attackPath = buildAttackPath(
      bestMatch.attackPathTemplate,
      matchingFindings
    );
  }

  return {
    primary,
    related,
    sharedContext,
    compoundingEffect: bestMatch.effect,
    adjustedSeverity,
    attackPath,
  };
}

/**
 * Create a generic correlation for findings without specific rules
 */
function createGenericCorrelation(findings: Finding[]): CorrelatedFinding {
  // Sort by severity
  findings.sort((a, b) =>
    severityToNumber(b.severity) - severityToNumber(a.severity)
  );

  const primary = findings[0]!;
  const related = findings.slice(1);
  const evidence = primary.evidence[0];

  return {
    primary,
    related,
    sharedContext: {
      file: evidence?.file,
      functionName: evidence?.symbol,
      findingCount: findings.length,
    },
    compoundingEffect: {
      description: `Multiple security issues in the same location (${findings.length} findings)`,
      riskMultiplier: 1.0 + (findings.length - 1) * 0.2,
      signals: findings.map(f => f.invariantId),
    },
    adjustedSeverity: primary.severity,
  };
}

// ============================================================================
// Attack Path Builder
// ============================================================================

/**
 * Build an attack path from a template and findings
 */
function buildAttackPath(
  template: Omit<AttackPath, 'steps'>,
  findings: Finding[]
): AttackPath {
  const steps: AttackStep[] = [];

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i]!;
    const evidence = finding.evidence[0];

    steps.push({
      step: i + 1,
      description: getAttackStepDescription(finding),
      invariantId: finding.invariantId,
      location: evidence ? { file: evidence.file, line: evidence.line } : undefined,
    });
  }

  return {
    ...template,
    steps,
  };
}

/**
 * Get a description for an attack step based on the finding
 */
function getAttackStepDescription(finding: Finding): string {
  const invariant = finding.invariantId;

  switch (invariant) {
    case 'WEBHOOK.IDEMPOTENT':
      return 'Attacker replays webhook request (no idempotency protection)';
    case 'TRANSACTION.POST_COMMIT.SIDE_EFFECTS':
      return 'Side effect fires inside transaction (may be duplicated or inconsistent)';
    case 'AUTHZ.SERVICE_LAYER.ENFORCED':
      return 'Service function called without authorization check';
    case 'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE':
      return 'Membership/role change does not immediately revoke access';
    case 'AUTHZ.KEYS.REVOCATION.IMMEDIATE':
      return 'API key revocation does not immediately invalidate the key';
    case 'CACHE.INVALIDATION.ON_AUTH_CHANGE':
      return 'Auth change does not invalidate cached permissions';
    case 'BILLING.SERVER_ENFORCED':
      return 'Billing/entitlement check bypassed or missing';
    case 'JOBS.RETRY_SAFE':
      return 'Background job is not idempotent (retry causes duplicates)';
    default:
      return finding.message;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function severityToNumber(severity: Severity): number {
  switch (severity) {
    case 'P0': return 3;
    case 'P1': return 2;
    case 'P2': return 1;
    default: return 0;
  }
}

function numberToSeverity(num: number): Severity {
  if (num >= 3) return 'P0';
  if (num >= 2) return 'P1';
  return 'P2';
}

function calculateAdjustedSeverity(
  baseSeverity: Severity,
  multiplier: number
): Severity {
  const base = severityToNumber(baseSeverity);
  const adjusted = Math.min(3, Math.ceil(base * multiplier));
  return numberToSeverity(adjusted);
}

function findingId(finding: Finding): string {
  const evidence = finding.evidence[0];
  return `${finding.invariantId}:${evidence?.file ?? 'unknown'}:${evidence?.line ?? 0}`;
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format a correlated finding for display
 */
export function formatCorrelatedFinding(correlation: CorrelatedFinding): string {
  const lines: string[] = [];

  // Header
  const location = correlation.sharedContext.file
    ? `${correlation.sharedContext.file}:${correlation.sharedContext.functionName ?? 'unknown'}`
    : 'Unknown location';

  lines.push(`\n┌─ CORRELATED FINDINGS ─ ${location}`);
  lines.push(`│`);

  // Primary finding
  lines.push(`│ [${correlation.adjustedSeverity}] ${correlation.primary.message}`);
  lines.push(`│     └─ ${correlation.primary.invariantId}`);

  // Related findings
  for (const related of correlation.related) {
    lines.push(`│ [${related.severity}] ${related.message}`);
    lines.push(`│     └─ ${related.invariantId}`);
  }

  lines.push(`│`);

  // Compounding effect
  lines.push(`│ ⚠ Compounding Effect:`);
  lines.push(`│   ${correlation.compoundingEffect.description}`);
  lines.push(`│   Risk multiplier: ${correlation.compoundingEffect.riskMultiplier}x`);

  // Attack path (if available)
  if (correlation.attackPath) {
    lines.push(`│`);
    lines.push(`│ 🎯 Attack Path: ${correlation.attackPath.title}`);
    lines.push(`│   Exploitability: ${correlation.attackPath.exploitability}`);
    lines.push(`│   Impact: ${correlation.attackPath.impact}`);
    if (correlation.attackPath.timeWindow) {
      lines.push(`│   Time window: ${correlation.attackPath.timeWindow}`);
    }
    lines.push(`│`);
    for (const step of correlation.attackPath.steps) {
      lines.push(`│   ${step.step}. ${step.description}`);
    }
  }

  lines.push(`└────────────────────────────────────────`);

  return lines.join('\n');
}

/**
 * Format correlation statistics
 */
export function formatCorrelationStats(result: CorrelationResult): string {
  const { stats } = result;

  return `
Correlation Analysis:
  Total findings: ${stats.totalFindings}
  Correlated: ${stats.correlatedFindings} (${Math.round(stats.correlatedFindings / stats.totalFindings * 100)}%)
  Correlation groups: ${stats.correlationGroups}
  Severity escalations: ${stats.severityEscalations}
`.trim();
}

export default correlateFindings;
