#!/usr/bin/env node

/**
 * SecurityChecks MCP Server (scheck)
 *
 * Catch what Copilot misses — production-ready code review.
 * MCP server that exposes scheck tools for LLM integration.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CompatibilityCallToolResult, CreateTaskResult } from '@modelcontextprotocol/sdk/types.js';
import {
  getInvariantById,
  ALL_INVARIANTS,
  type AuditResult,
  type Finding,
} from '@securitychecks/collector';
import { audit } from '@securitychecks/cli';
import {
  formatEvidenceForMcp,
  parseAllowedRootsFromEnv,
  resolveAndValidateTargetPath,
  type EvidenceForMcp,
} from './safety.js';
import { generateTestSkeleton, getStaffQuestion } from './templates.js';
import { handleFeedbackTool } from './feedback.js';

// Version injected at build time via tsup define
const version = process.env['MCP_VERSION'] ?? '0.0.0-dev';

const server = new Server(
  {
    name: 'scheck',
    version: version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const TOOL_PREFIXES = ['scheck'] as const;
type ToolSuffix = 'run' | 'list_findings' | 'explain' | 'list_invariants' | 'generate_test' | 'feedback';
type ToolDef = {
  suffix: ToolSuffix;
  description: string;
  inputSchema: unknown;
};

const TOOL_DEFS: ToolDef[] = [
  {
    suffix: 'run',
    description:
      'Run scheck — the patterns a senior engineer would flag in review. ' +
      'Catches webhook idempotency, auth at service layer, transaction safety, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target path to audit (default: current directory)',
        },
        include_context: {
          type: 'boolean',
          description:
            'Include code context snippets in results (may expose source code to the assistant).',
        },
        max_findings: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Limit number of findings returned (default: 200)',
        },
        only: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only run specific invariant checks by ID',
        },
        skip: {
          type: 'array',
          items: { type: 'string' },
          description: 'Skip specific invariant checks by ID',
        },
      },
    },
  },
  {
    suffix: 'list_findings',
    description:
      'List issues a staff engineer would flag — current findings from the last run, by severity.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Filter findings by severity',
        },
        include_context: {
          type: 'boolean',
          description:
            'Include code context snippets in results (may expose source code to the assistant).',
        },
        max_findings: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Limit number of findings returned (default: 200)',
        },
      },
    },
  },
  {
    suffix: 'explain',
    description:
      'What a staff engineer checks: explain why a pattern matters, real incidents it prevents, and proof needed.',
    inputSchema: {
      type: 'object',
      properties: {
        invariant_id: {
          type: 'string',
          description: 'The invariant ID to explain (e.g., AUTHZ.SERVICE_LAYER.ENFORCED)',
        },
      },
      required: ['invariant_id'],
    },
  },
  {
    suffix: 'list_invariants',
    description:
      'List all patterns a staff engineer checks for — the patterns that prevent production incidents.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (authz, revocation, webhooks, transactions, etc.)',
        },
        severity: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Filter by severity',
        },
      },
    },
  },
  {
    suffix: 'generate_test',
    description:
      'Generate test code that proves a pattern is enforced — the proof a staff engineer would ask for.',
    inputSchema: {
      type: 'object',
      properties: {
        invariant_id: {
          type: 'string',
          description: 'The invariant ID to generate a test for',
        },
        framework: {
          type: 'string',
          enum: ['jest', 'vitest', 'playwright'],
          description: 'Test framework to generate code for (default: vitest)',
        },
        context: {
          type: 'string',
          description:
            'Additional context about the specific violation to generate a more targeted test',
        },
      },
      required: ['invariant_id'],
    },
  },
  {
    suffix: 'feedback',
    description:
      'Report whether a finding was a true positive or false positive to improve accuracy.',
    inputSchema: {
      type: 'object',
      properties: {
        invariant_id: {
          type: 'string',
          description: 'Invariant ID (e.g., AUTHZ.SERVICE_LAYER.ENFORCED)',
        },
        verdict: {
          type: 'string',
          enum: ['true_positive', 'false_positive'],
          description: 'Whether the finding was a true positive or false positive',
        },
        reason: {
          type: 'string',
          enum: [
            'not_applicable',
            'acceptable_risk',
            'wrong_location',
            'outdated_pattern',
            'missing_context',
          ],
          description: 'Reason for the verdict',
        },
      },
      required: ['invariant_id', 'verdict'],
    },
  },
];

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_PREFIXES.flatMap((prefix) =>
      TOOL_DEFS.map((def) => ({
        name: `${prefix}_${def.suffix}`,
        description: def.description,
        inputSchema: def.inputSchema,
      }))
    ),
  };
});

// Track last audit result for list_findings
let lastAuditResult: AuditResult | null = null;

// Handle tool calls
server.setRequestHandler(
  CallToolRequestSchema,
  async (request): Promise<CompatibilityCallToolResult | CreateTaskResult> => {
  const { name, arguments: args } = request.params;
  const tool = normalizeToolName(name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  switch (tool) {
    case 'run': {
      const path = (args?.['path'] as string) || process.cwd();
      const only = args?.['only'] as string[] | undefined;
      const skip = args?.['skip'] as string[] | undefined;
      const includeContext = args?.['include_context'] === true;
      const maxFindings =
        typeof args?.['max_findings'] === 'number'
          ? Math.max(1, Math.min(500, args['max_findings'] as number))
          : 200;

      try {
        const allowedRoots = parseAllowedRootsFromEnv(process.env, process.cwd());
        const targetPath = resolveAndValidateTargetPath(path, {
          cwd: process.cwd(),
          allowedRoots,
        });

        const result = await audit({
          targetPath,
          only,
          skip,
        });

        lastAuditResult = result;

        // Format findings for LLM consumption
        const findings: Finding[] = result.results.flatMap((r) => r.findings);
        const truncated = findings.length > maxFindings;
        const findingsToReturn = truncated ? findings.slice(0, maxFindings) : findings;
        const summary = {
          total_checks: result.summary.total,
          passed: result.summary.passed,
          failed: result.summary.failed,
          findings_count: findings.length,
          by_severity: result.summary.byPriority,
          truncated,
          max_findings: maxFindings,
        };

        const formattedFindings = findingsToReturn.map((f: Finding) => ({
          invariant_id: f.invariantId,
          severity: f.severity,
          message: f.message,
          evidence: formatEvidenceForMcp(f.evidence as EvidenceForMcp[], includeContext),
          required_proof: f.requiredProof,
          suggested_test: f.suggestedTest,
          staff_engineer_asks: getStaffQuestion(f.invariantId),
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  summary,
                  findings: formattedFindings,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: formatMcpRunError(error),
            },
          ],
          isError: true,
        };
      }
    }

    case 'list_findings': {
      if (!lastAuditResult) {
        return {
          content: [
            {
              type: 'text',
              text: 'No scan has been run yet. Use scheck_run first.',
            },
          ],
        };
      }

      const severity = args?.['severity'] as string | undefined;
      const includeContext = args?.['include_context'] === true;
      const maxFindings =
        typeof args?.['max_findings'] === 'number'
          ? Math.max(1, Math.min(500, args['max_findings'] as number))
          : 200;
      let findings: Finding[] = lastAuditResult.results.flatMap((r) => r.findings);

      if (severity) {
        findings = findings.filter((f: Finding) => f.severity === severity);
      }

      const truncated = findings.length > maxFindings;
      const findingsToReturn = truncated ? findings.slice(0, maxFindings) : findings;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                findings: findingsToReturn.map((f: Finding) => ({
                  invariant_id: f.invariantId,
                  severity: f.severity,
                  message: f.message,
                  evidence: formatEvidenceForMcp(f.evidence as EvidenceForMcp[], includeContext),
                })),
                meta: {
                  total: findings.length,
                  truncated,
                  max_findings: maxFindings,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'explain': {
      const invariantId = args?.['invariant_id'] as string;
      const invariant = getInvariantById(invariantId);

      if (!invariant) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown pattern: ${invariantId}. Use scheck_list_invariants to see available patterns.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: invariant.id,
                name: invariant.name,
                severity: invariant.severity,
                category: invariant.category,
                description: invariant.description,
                required_proof: invariant.requiredProof,
                staff_engineer_asks: getStaffQuestion(invariant.id),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'list_invariants': {
      const category = args?.['category'] as string | undefined;
      const severity = args?.['severity'] as string | undefined;

      let invariants = ALL_INVARIANTS;

      if (category) {
        invariants = invariants.filter((i) => i.category === category);
      }
      if (severity) {
        invariants = invariants.filter((i) => i.severity === severity);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              invariants.map((i) => ({
                id: i.id,
                name: i.name,
                severity: i.severity,
                category: i.category,
              })),
              null,
              2
            ),
          },
        ],
      };
    }

    case 'generate_test': {
      const invariantId = args?.['invariant_id'] as string;
      const framework = (args?.['framework'] as string) || 'vitest';
      const context = args?.['context'] as string | undefined;

      const invariant = getInvariantById(invariantId);
      if (!invariant) {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown invariant: ${invariantId}`,
            },
          ],
        };
      }

      const test = generateTestSkeleton(invariant, framework, context);

      return {
        content: [
          {
            type: 'text',
            text: test,
          },
        ],
      };
    }

    case 'feedback': {
      return handleFeedbackTool(args as Record<string, unknown> | undefined);
    }
  }
  }
);

function normalizeToolName(name: string): ToolSuffix | null {
  const suffix = name.replace(/^scheck_/, '') as ToolSuffix;
  const allowed = new Set<ToolSuffix>([
    'run',
    'list_findings',
    'explain',
    'list_invariants',
    'generate_test',
    'feedback',
  ]);
  return allowed.has(suffix) ? suffix : null;
}

function formatMcpRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/no allowed roots are configured and no git repository was detected/i.test(message)) {
    return [
      'Refusing to scan: no git repository detected and no allowed roots configured.',
      '',
      'Fix:',
      '- Start the MCP server from inside the repo you want to scan, or',
      '- Set SCHECK_MCP_ALLOWED_ROOTS (or MCP_ALLOWED_ROOTS) in your MCP server config.',
      '',
      'Example (Claude Code):',
      '{',
      '  "mcpServers": {',
      '    "scheck": {',
      '      "command": "scheck-mcp",',
      '      "env": { "SCHECK_MCP_ALLOWED_ROOTS": "." }',
      '    }',
      '  }',
      '}',
    ].join('\n');
  }

  return `Error running audit: ${message}`;
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SecurityChecks MCP server (scheck) running on stdio');
}

main().catch(console.error);
