/**
 * SARIF (Static Analysis Results Interchange Format) output
 *
 * Converts SecurityChecks findings to SARIF format for integration with:
 * - GitHub Code Scanning
 * - VS Code SARIF Viewer
 * - Other security tools
 *
 * @see https://sarifweb.azurewebsites.net/
 */

import type { AuditResult, Finding } from '@securitychecks/collector';
import { getInvariantById } from '@securitychecks/collector';
import { generateFindingId } from '../findings/index.js';

// SARIF 2.1.0 types (simplified)
interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: SarifTool;
  results: SarifResult[];
  invocations?: SarifInvocation[];
}

interface SarifTool {
  driver: SarifDriver;
}

interface SarifDriver {
  name: string;
  informationUri: string;
  version: string;
  rules: SarifRule[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration?: {
    level: 'error' | 'warning' | 'note' | 'none';
  };
  properties?: {
    tags?: string[];
    precision?: string;
    'security-severity'?: string;
  };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note' | 'none';
  message: { text: string };
  locations?: SarifLocation[];
  fingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

interface SarifLocation {
  physicalLocation?: {
    artifactLocation?: {
      uri: string;
      uriBaseId?: string;
    };
    region?: {
      startLine?: number;
      startColumn?: number;
      endLine?: number;
      endColumn?: number;
    };
  };
}

interface SarifInvocation {
  executionSuccessful: boolean;
  endTimeUtc?: string;
}

/**
 * Map SecurityChecks severity to SARIF level
 */
function severityToLevel(severity: string): 'error' | 'warning' | 'note' {
  switch (severity) {
    case 'P0':
      return 'error';
    case 'P1':
      return 'warning';
    case 'P2':
    default:
      return 'note';
  }
}

/**
 * Map SecurityChecks severity to SARIF security-severity score (0-10)
 * GitHub uses this for severity ordering
 */
function severityToScore(severity: string): string {
  switch (severity) {
    case 'P0':
      return '9.0'; // Critical
    case 'P1':
      return '7.0'; // High
    case 'P2':
    default:
      return '4.0'; // Medium
  }
}

/**
 * Build SARIF rules from findings
 */
function buildRules(findings: Finding[]): SarifRule[] {
  const seenIds = new Set<string>();
  const rules: SarifRule[] = [];

  for (const finding of findings) {
    if (seenIds.has(finding.invariantId)) continue;
    seenIds.add(finding.invariantId);

    const invariant = getInvariantById(finding.invariantId);

    rules.push({
      id: finding.invariantId,
      name: invariant?.name ?? finding.invariantId,
      shortDescription: {
        text: invariant?.description ?? finding.message,
      },
      fullDescription: invariant
        ? { text: `${invariant.description}\n\nRequired proof: ${invariant.requiredProof}` }
        : undefined,
      helpUri: `https://securitychecks.ai/docs/invariants/${finding.invariantId.toLowerCase().replace(/\./g, '-')}`,
      defaultConfiguration: {
        level: severityToLevel(finding.severity),
      },
      properties: {
        tags: ['security', 'production-invariant'],
        precision: 'high',
        'security-severity': severityToScore(finding.severity),
      },
    });
  }

  return rules;
}

/**
 * Convert a finding to a SARIF result
 */
function findingToResult(finding: Finding, ruleIndex: number): SarifResult {
  const locations: SarifLocation[] = finding.evidence.map((ev) => ({
    physicalLocation: {
      artifactLocation: {
        uri: ev.file,
        uriBaseId: '%SRCROOT%',
      },
      region: {
        startLine: ev.line,
        startColumn: 1,
      },
    },
  }));

  return {
    ruleId: finding.invariantId,
    ruleIndex,
    level: severityToLevel(finding.severity),
    message: {
      text: finding.message,
    },
    locations,
    fingerprints: {
      scheckId: generateFindingId(finding),
    },
    properties: {
      severity: finding.severity,
      waived: finding.waived ?? false,
    },
  };
}

/**
 * Convert AuditResult to SARIF format
 */
export function toSarif(result: AuditResult, version: string): SarifLog {
  const findings = result.results.flatMap((r) => r.findings);
  const rules = buildRules(findings);

  // Build rule index map for ruleIndex references
  const ruleIndexMap = new Map<string, number>();
  rules.forEach((rule, index) => {
    ruleIndexMap.set(rule.id, index);
  });

  const results = findings.map((finding) =>
    findingToResult(finding, ruleIndexMap.get(finding.invariantId) ?? 0)
  );

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'securitychecks',
            informationUri: 'https://securitychecks.ai',
            version,
            rules,
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: result.runAt,
          },
        ],
      },
    ],
  };
}
