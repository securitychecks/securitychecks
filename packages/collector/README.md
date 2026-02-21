# @securitychecks/collector

> **Extract structural facts from code** — The fact extraction engine for SecurityChecks.

[![npm version](https://img.shields.io/npm/v/@securitychecks/collector.svg?style=flat-square)](https://www.npmjs.com/package/@securitychecks/collector)

Part of [SecurityChecks](https://securitychecks.ai) — production-ready code review for AI-generated code.

## What is this?

The collector (`scc`) extracts structural facts from TypeScript/JavaScript codebases via AST parsing. It emits facts, not judgments — the CLI (`scheck`) applies invariant checks to these facts.

**Philosophy:** "The collector emits facts. Products interpret facts. Policy never lives in the collector."

## Installation

```bash
npm install @securitychecks/collector

# Or run directly
npx scc --help
```

## Usage

### CLI

```bash
# Extract facts to JSON artifact
scc extract /path/to/project --output artifacts.json

# Use specific profile
scc extract /path/to/project --profile securitychecks
```

### Programmatic API

```typescript
import { extract } from '@securitychecks/collector';

// Extract artifact from codebase
const artifact = await extract('/path/to/project', {
  profile: 'securitychecks'
});

console.log(`Found ${artifact.services.length} services`);
console.log(`Found ${artifact.authzCalls.length} auth calls`);
console.log(`Found ${artifact.webhookHandlers.length} webhook handlers`);
```

## Extraction Profiles

| Profile | Purpose | Extractors |
|---------|---------|------------|
| `securitychecks` | Default for scheck | All security-relevant facts |
| `trackstack` | Package intelligence | Dependencies, imports |
| `all` | Complete extraction | Everything |

## Extractors

The collector runs these extractors in parallel:

| Extractor | What It Extracts |
|-----------|------------------|
| **Services** | Exported functions in service/lib files |
| **AuthZ** | Authorization calls (guards, middleware, decorators) |
| **Webhooks** | Webhook handlers with idempotency markers |
| **Transactions** | Transaction scopes and side effects within |
| **Cache** | Cache get/set/delete operations |
| **Jobs** | Background job handlers |
| **Tests** | Test files with confidence analysis |
| **Routes** | API routes with middleware detection |
| **Call Graph** | Function-to-function relationships |
| **Data Flow** | Taint sources, sinks, transforms |
| **Membership** | Role/permission mutation operations |

## Framework Support

Authorization detection supports multiple frameworks:

- **NestJS:** `@UseGuards`, `@Roles`, `@RequirePermission`
- **Next.js:** `getServerSession`, `auth()`, `withAuth`
- **Express:** Middleware patterns, `req.user` checks
- **tRPC:** `protectedProcedure`, `authedProcedure`
- **Clerk:** `auth()`, `currentUser`, `getAuth`
- **Lucia:** `validateRequest`, `validateSession`

Webhook detection supports 14+ providers:
- Stripe, GitHub, Slack, Svix, Clerk, Resend
- Paddle, LemonSqueezy, Twilio, SendGrid, Postmark
- Shopify, PayPal, Plaid

## Artifact Schema

```typescript
interface CollectorArtifact {
  version: '1.0';
  schemaVersion: string;
  profile: 'securitychecks' | 'trackstack' | 'all';
  extractedAt: string;
  codebase: {
    file_count: number;
    languages: string[];
  };
  services: ServiceEntry[];
  authzCalls: AuthzCall[];
  cacheOperations: CacheOperation[];
  transactionScopes: TransactionScope[];
  webhookHandlers: WebhookHandler[];
  jobHandlers: JobHandler[];
  membershipMutations: MembershipMutation[];
  tests: TestEntry[];
  routes: RouteEntry[];
  callGraph: { nodes: CallGraphNode[] };
}
```

## Privacy

No source code leaves your machine. We extract structural facts only:
- What functions exist and their names
- Where auth is called
- Webhook handler patterns
- Transaction boundaries
- Call relationships

**The artifact contains no implementation details** — only structural facts about code organization.

## License

Apache-2.0. See [LICENSE](../LICENSE) for details.
