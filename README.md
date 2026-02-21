# SecurityChecks

**Catch production security bugs that pass tests and slip past scanners.**

[![npm version](https://img.shields.io/npm/v/@securitychecks/cli.svg?style=flat-square)](https://www.npmjs.com/package/@securitychecks/cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](LICENSE)

SecurityChecks enforces **backend invariants** — the kinds of issues senior engineers catch in review, but conventional SAST tools and AI code assistants routinely miss.

## Quick Start

```bash
npx @securitychecks/cli run
```

No signup required. Your code never leaves your machine.

## What It Catches

| Invariant | What It Catches | Severity |
|-----------|-----------------|----------|
| `AUTHZ.SERVICE_LAYER.ENFORCED` | Auth bypassed via internal calls | P0 |
| `WEBHOOK.IDEMPOTENT` | Double-charges on webhook retry | P0 |
| `WEBHOOK.SIGNATURE.VERIFIED` | Accepting forged webhook payloads | P0 |
| `TRANSACTION.POST_COMMIT.SIDE_EFFECTS` | Phantom emails after rollback | P0 |
| `DATAFLOW.UNTRUSTED.SQL_QUERY` | SQL injection from user input | P0 |
| `AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE` | Fired employee still has access | P0 |
| `CACHE.INVALIDATION.ON_AUTH_CHANGE` | Stale permissions after role changes | P1 |

[See all 15+ invariants →](https://securitychecks.ai/docs/invariants)

## Packages

This repo contains the open-source components of SecurityChecks:

| Package | Description |
|---------|-------------|
| [`@securitychecks/cli`](packages/cli) | CLI client (`scheck`) — scan your codebase for invariant violations |
| [`@securitychecks/collector`](packages/collector) | Fact extractor (`scc`) — extracts structural facts from code via AST parsing |
| [`@securitychecks/mcp`](packages/mcp) | MCP server (`scheck-mcp`) — expose scheck tools to AI assistants (Claude, Cursor) |

**Not included:** The proprietary invariant evaluation engine and the SecurityChecks SaaS platform.

## Installation

```bash
# CLI
npm install -g @securitychecks/cli

# MCP server (for Claude Code, Cursor)
npm install -g @securitychecks/mcp
```

## Framework Support

18 frameworks with production-ready detection: Next.js, Express, NestJS, SvelteKit, Remix, Nuxt, Hono, Fastify, and more.

## Privacy

- **Local execution** — all analysis runs on your machine
- **No code upload** — only structural facts (never raw source) are sent to the cloud for invariant analysis
- **Cloud optional** — dashboard sync is opt-in

## Links

- [Website](https://securitychecks.ai)
- [Documentation](https://securitychecks.ai/docs)
- [CLI Reference](https://securitychecks.ai/docs/cli/commands)
- [Changelog](CHANGELOG.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

Apache-2.0. See [LICENSE](LICENSE) for details.
