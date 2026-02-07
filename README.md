# SecurityChecks OSS (Open-Core)

This repo contains the open-source components of SecurityChecks:

- `@securitychecks/collector`: extracts privacy-preserving facts (artifacts) from a codebase
- `@securitychecks/cli` (`scheck`): CLI client that submits artifacts to the SecurityChecks cloud API
- `@securitychecks/mcp` (`scheck-mcp`): MCP server wrapper around `scheck`

What is NOT included here:

- The proprietary invariant checkers (evaluation engine)
- The SecurityChecks SaaS (web app, API backend, workers, dashboards)

## License

Apache-2.0. See `LICENSE`.
