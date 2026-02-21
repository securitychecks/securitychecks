# Changelog

All notable changes to the SecurityChecks open-source packages are documented here.

## [0.2.0] - 2026-02-21

### Added
- **Readiness score** — every scan now returns a 0-100 score and letter grade (A/B/C/F). Score is capped at 49 if any P0 findings exist. Available in CLI output, JSON, and MCP.
- **`scheck preflight`** — curated deployment readiness check. Runs 10 ship-critical invariants and returns a pass/fail checklist with readiness score.
- **MCP readiness_score** — `scheck_run` MCP tool now includes `readiness_score` object in response.

### Changed
- CLI `run` output now displays readiness score after the stats summary.
- `AuditResult.summary` type now includes optional `score` and `grade` fields.

## [0.1.1] - 2026-02-08

### Fixed
- Reduced false positives by 89% through three rounds of checker tuning.
- Eliminated webhook soft-delete and tautological test false positives.

## [0.1.0] - 2026-01-28

### Added
- Initial release of `@securitychecks/collector`, `@securitychecks/cli`, and `@securitychecks/mcp`.
- 15 production invariants across 6 categories.
- 18 framework support with automatic detection.
- Hybrid local + cloud scanning architecture.
- SARIF output for GitHub Code Scanning.
- Baseline management, waiver system, and git hooks.
- MCP server for AI assistant integration.
