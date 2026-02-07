# @securitychecks/cli

Enforce backend invariants in your codebase. Find authorization gaps, race conditions, and transaction bugs before they ship.

## Quick Start

```bash
npx @securitychecks/cli run
```

That's it. No signup required. The CLI runs locally and your code never leaves your machine.

## Installation

```bash
# Global install
npm install -g @securitychecks/cli

# Then run
scheck run
```

## What It Checks

SecurityChecks enforces backend invariants that cause production incidents:

| Invariant | What It Catches |
|-----------|-----------------|
| `AUTHZ.SERVICE_LAYER` | Service methods callable without authorization |
| `WEBHOOK.IDEMPOTENT` | Webhooks that double-process on retry |
| `WEBHOOK.SIGNATURE.VERIFIED` | Unverified webhook signatures |
| `TRANSACTION.SIDE_EFFECTS` | Emails/notifications sent before commit |
| `CACHE.INVALIDATION` | Stale permissions after auth changes |
| `DATAFLOW.UNTRUSTED.SQL` | SQL injection via string interpolation |
| `AUTHZ.RLS.MULTI_TENANT` | Missing tenant isolation in queries |

## Commands

### `scheck run`

Scan your codebase for security invariants.

```bash
# Basic scan
scheck run

# Scan specific path
scheck run --path ./src

# CI mode - fail on new violations
scheck run --ci

# Output as JSON
scheck run --json

# Generate SARIF report (for GitHub Code Scanning)
scheck run --sarif report.sarif

# Only check changed files
scheck run --changed

# Watch mode
scheck run --watch
```

**Options:**
- `-p, --path <path>` - Target path (default: current directory)
- `--changed` - Only check changed files (requires git)
- `--ci` - CI mode - fail on new violations
- `--all` - Show all findings including P2
- `--only <invariants...>` - Only run specific checks
- `--skip <invariants...>` - Skip specific checks
- `--json` - Output as JSON
- `--sarif <path>` - Write SARIF report
- `-v, --verbose` - Verbose output
- `-w, --watch` - Watch for changes

### `scheck explain <invariant>`

Get a deep-dive on any invariant - why it matters, what good looks like.

```bash
scheck explain AUTHZ.SERVICE_LAYER
scheck explain WEBHOOK.IDEMPOTENT
```

### `scheck baseline`

Manage known issues so you can adopt incrementally.

```bash
# Mark current findings as known
scheck baseline --update

# Show current baseline
scheck baseline --show

# Remove stale entries
scheck baseline --prune
```

### `scheck waive <findingId>`

Temporarily waive a finding with a reason and expiration.

```bash
scheck waive AUTHZ.SERVICE_LAYER:src/services/user.ts:42 \
  --reason-key will_fix_later \
  --reason "Auth handled by upstream middleware" \
  --expires 30d
```

### `scheck init`

Initialize SecurityChecks in your project.

```bash
# Basic init
scheck init

# With git pre-commit hook
scheck init --hooks
```

## Cloud Features (Optional)

Connect to SecurityChecks cloud for dashboards, team collaboration, and CI integration.

```bash
# Login with API key
scheck login --api-key sk_xxx

# Or set environment variable
export SECURITYCHECKS_API_KEY=sk_xxx

# Sync findings to dashboard
scheck sync --project my-project
```

Get your API key at [securitychecks.ai](https://securitychecks.ai).

## CI Integration

### GitHub Actions

```yaml
- name: Run SecurityChecks
  run: npx @securitychecks/cli run --ci
```

### With baseline (recommended)

```yaml
- name: Run SecurityChecks
  run: |
    npx @securitychecks/cli run --ci
  # Fails only on NEW findings, not baselined ones
```

## Privacy

- **Local execution**: All analysis runs on your machine
- **No code upload**: Your code never leaves your environment
- **Cloud optional**: Dashboard sync is opt-in only

## Links

- [Documentation](https://securitychecks.ai/docs)
- [Invariant Reference](https://securitychecks.ai/docs/invariants)
- [GitHub](https://github.com/securitychecks/securitychecks.ai)

## License

Apache-2.0. See [LICENSE](../../LICENSE) for details.
