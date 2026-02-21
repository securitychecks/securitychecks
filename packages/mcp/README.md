# @securitychecks/mcp

> **Review AI-generated code with AI** — MCP server for production-ready code review.

[![npm version](https://img.shields.io/npm/v/@securitychecks/mcp.svg?style=flat-square)](https://www.npmjs.com/package/@securitychecks/mcp)

MCP server that lets Claude catch what Copilot misses — webhook idempotency, service-layer auth, transaction safety.

## What is this?

Your AI assistant writes code. This gives it the ability to review that code for production-readiness.

**The loop:** Copilot/Cursor writes → Claude reviews via MCP → Ship with confidence.

Claude can now check for the patterns that cause production incidents, based on what staff engineers actually catch in review.

## Installation

```bash
npm install -g @securitychecks/mcp
```

## Usage with Claude Code

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "scheck": {
      "command": "scheck-mcp",
      "args": [],
      "env": {
        "SCHECK_MCP_ALLOWED_ROOTS": "."
      }
    }
  }
}
```

### Allowed roots (required)
For safety, `scheck-mcp` will only run inside the allowed roots. If you don’t set `SCHECK_MCP_ALLOWED_ROOTS` and the server is not started inside a git repository, it will refuse to scan.

## Available Tools

### `scheck_run`
Run scheck on the codebase.

```
Arguments:
- path (optional): Target path to audit
- changed_only (optional): Only check changed files
```

### `scheck_list_findings`
List current findings from the last run.

```
Arguments:
- severity (optional): Filter by severity (P0, P1, P2)
```

### `scheck_explain`
Explain an invariant - what a staff engineer would say about it.

```
Arguments:
- invariant_id: The invariant to explain (e.g., "AUTHZ.SERVICE_LAYER.ENFORCED")
```

### `scheck_list_invariants`
List all patterns a staff engineer checks for.

### `scheck_generate_test`
Generate a test skeleton to prove an invariant is satisfied.

```
Arguments:
- invariant_id: The invariant to generate a test for
- file_path (optional): Target file for the test
```

## Example Session

```
User: Check my code for issues a senior engineer would catch

Claude: [calls scheck_run]

Found 2 issues a staff engineer would flag:

1. **AUTHZ.SERVICE_LAYER.ENFORCED** (P0)
   Service "MembershipService" has exports without auth checks
   Location: src/services/membership.ts:12

   A staff engineer would ask: "What happens when a background
   job calls removeMember() directly, bypassing the route?"

2. **WEBHOOK.IDEMPOTENT** (P0)
   Webhook handler missing idempotency check
   Location: src/api/webhooks/stripe.ts:45

   A staff engineer would ask: "What happens when Stripe
   retries this webhook?"

User: Explain the webhook issue

Claude: [calls scheck_explain with invariant_id="WEBHOOK.IDEMPOTENT"]

Webhooks can be delivered multiple times. Without idempotency,
you might double-charge customers, send duplicate emails, or
corrupt data...
```

## Why MCP?

AI writes code fast but doesn't reason about production scenarios:

- Webhook retries → double-charges
- Internal service calls → auth bypass
- Transaction rollbacks → phantom emails

This MCP server gives Claude the ability to catch these patterns — the things AI-generated code routinely misses.

## Enterprise

For teams with compliance requirements:

- **Audit trails:** Every AI-assisted review is logged
- **Local analysis:** SOC2 compliant — no source code transmission
- **Consistent patterns:** Same staff check for all developers

## License

Apache-2.0. See [LICENSE](../LICENSE) for details.
