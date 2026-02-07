/* eslint-disable max-lines */
/**
 * All invariant definitions for SecurityChecks
 *
 * P0 - Critical security invariants (must not ship if violated)
 * P1 - Important invariants (should fix before shipping)
 * P2 - Best practice invariants (fix when convenient)
 */

import type { InvariantDefinition } from './types.js';

// ============================================================================
// P0 - Critical Invariants
// ============================================================================

export const AUTHZ_SERVICE_LAYER_ENFORCED: InvariantDefinition = {
  id: 'AUTHZ.SERVICE_LAYER.ENFORCED',
  name: 'Service Layer Authorization',
  description:
    'Authorization must be enforced at the service layer, not only at routes/controllers. ' +
    'Route-level auth alone is insufficient because services can be called from multiple entry points.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Service-level tests asserting that unauthorized access to tenant resources fails. ' +
    'Each service function that accesses tenant data should have a test proving auth is checked.',
};

export const AUTHZ_MEMBERSHIP_REVOCATION_IMMEDIATE: InvariantDefinition = {
  id: 'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE',
  name: 'Immediate Membership Revocation',
  description:
    'When a user is removed from a team or has their role downgraded, their access must be ' +
    'revoked immediately. Cached membership data must be invalidated synchronously.',
  severity: 'P0',
  category: 'revocation',
  requiredProof:
    'Test that: (1) downgrades role, (2) immediately attempts access, (3) access is denied. ' +
    'No TTL grace period should allow continued access after revocation.',
};

export const AUTHZ_KEYS_REVOCATION_IMMEDIATE: InvariantDefinition = {
  id: 'AUTHZ.KEYS.REVOCATION.IMMEDIATE',
  name: 'Immediate API Key Revocation',
  description:
    'When an API key is revoked, it must stop working immediately. ' +
    'Cached key validation must be invalidated synchronously on revocation.',
  severity: 'P0',
  category: 'revocation',
  requiredProof:
    'Test that: (1) creates key, (2) uses key successfully, (3) revokes key, ' +
    '(4) same request immediately fails with 401/403.',
};

export const WEBHOOK_IDEMPOTENT: InvariantDefinition = {
  id: 'WEBHOOK.IDEMPOTENT',
  name: 'Webhook Idempotency',
  description:
    'Webhook handlers must be idempotent. Replaying the same webhook event ' +
    '(same event ID) must not cause duplicate side effects.',
  severity: 'P0',
  category: 'webhooks',
  requiredProof:
    'Test that: (1) sends webhook event, (2) sends same event again (same ID), ' +
    '(3) side effect only happened once (e.g., one email, one DB write).',
};

export const WEBHOOK_SIGNATURE_VERIFIED: InvariantDefinition = {
  id: 'WEBHOOK.SIGNATURE.VERIFIED',
  name: 'Webhook Signature Verification',
  description:
    'Webhook handlers must verify signatures before processing. ' +
    'Without verification, anyone can forge events and trigger side effects.',
  severity: 'P0',
  category: 'webhooks',
  requiredProof:
    'Test that: (1) valid webhook signature is accepted, (2) invalid signature is rejected. ' +
    'Proof should show verification happens before any side effects.',
};

export const TRANSACTION_POST_COMMIT_SIDE_EFFECTS: InvariantDefinition = {
  id: 'TRANSACTION.POST_COMMIT.SIDE_EFFECTS',
  name: 'Post-Commit Side Effects',
  description:
    'External side effects (emails, webhooks, analytics, external APIs) must occur ' +
    'after the database transaction commits, not inside it. If the transaction rolls back, ' +
    'side effects should not have been triggered.',
  severity: 'P0',
  category: 'transactions',
  requiredProof:
    'Test that: (1) triggers action that should send email/webhook, ' +
    '(2) DB transaction fails/rolls back, (3) no email/webhook was sent.',
};

export const AUTHZ_RLS_MULTI_TENANT: InvariantDefinition = {
  id: 'AUTHZ.RLS.MULTI_TENANT',
  name: 'Row Level Security for Multi-Tenant Tables',
  description:
    'Multi-tenant tables must have Row Level Security (RLS) policies enabled. ' +
    'Without RLS, tenant data isolation depends entirely on application code, ' +
    'which is error-prone and can lead to data leaks between tenants.',
  severity: 'P0',
  category: 'rls',
  requiredProof:
    'SQL migrations showing: (1) ALTER TABLE ... ENABLE ROW LEVEL SECURITY, ' +
    '(2) CREATE POLICY with USING clause filtering by tenant context, ' +
    '(3) tests proving tenant A cannot access tenant B data.',
};

export const AUTHZ_TENANT_ISOLATION: InvariantDefinition = {
  id: 'AUTHZ.TENANT.ISOLATION',
  name: 'Tenant Isolation in Database Queries',
  description:
    'Database queries to multi-tenant tables must include tenant filtering. ' +
    'Queries without tenant filtering can return data from all tenants, ' +
    'causing critical data leaks in multi-tenant applications.',
  severity: 'P0',
  category: 'rls',
  requiredProof:
    'Either: (1) RLS policies enforced at database level, or ' +
    '(2) explicit tenant filtering in every query to multi-tenant tables. ' +
    'Tests proving cross-tenant queries return empty results.',
};

export const DATAFLOW_UNTRUSTED_SQL_QUERY: InvariantDefinition = {
  id: 'DATAFLOW.UNTRUSTED.SQL_QUERY',
  name: 'Untrusted Input in SQL/NoSQL Queries',
  description:
    'Untrusted input must not flow into raw SQL or NoSQL queries without validation or parameterization. ' +
    'Injection flaws can expose or mutate data across tenants.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Test that malicious payloads (e.g., SQL/NoSQL injection strings) are rejected or safely parameterized. ' +
    'Demonstrate that queries are parameterized or inputs are strictly validated.',
};

export const DATAFLOW_UNTRUSTED_COMMAND_EXEC: InvariantDefinition = {
  id: 'DATAFLOW.UNTRUSTED.COMMAND_EXEC',
  name: 'Untrusted Input in Command Execution',
  description:
    'Untrusted input must never reach command execution APIs (exec/spawn/eval) without strict allowlists. ' +
    'Command injection leads to full system compromise.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Test that user-supplied input cannot alter executed commands. ' +
    'Show allowlist validation and a regression test with malicious payloads.',
};

// ============================================================================
// P1 - Important Invariants
// ============================================================================

export const CACHE_INVALIDATION_ON_AUTH_CHANGE: InvariantDefinition = {
  id: 'CACHE.INVALIDATION.ON_AUTH_CHANGE',
  name: 'Cache Invalidation on Auth Change',
  description:
    'When membership, roles, or permissions change, all related cache entries must be ' +
    'invalidated synchronously. Stale cache must not grant access that was revoked.',
  severity: 'P1',
  category: 'cache',
  requiredProof:
    'Test that: (1) caches membership, (2) changes role/removes member, ' +
    '(3) immediately verifies cache was invalidated or reflects new state.',
};

export const JOBS_RETRY_SAFE: InvariantDefinition = {
  id: 'JOBS.RETRY_SAFE',
  name: 'Background Job Retry Safety',
  description:
    'Background jobs and queue handlers must be safe to retry. ' +
    'Running the same job twice must not cause duplicate side effects.',
  severity: 'P1',
  category: 'jobs',
  requiredProof:
    'Test that: (1) runs job handler, (2) runs same job again with same payload, ' +
    '(3) side effect only happened once or is correctly deduplicated.',
};

export const BILLING_SERVER_ENFORCED: InvariantDefinition = {
  id: 'BILLING.SERVER_ENFORCED',
  name: 'Server-Side Billing Enforcement',
  description:
    'Billing limits and entitlements must be enforced server-side. ' +
    'Client-side checks are not sufficient as they can be bypassed.',
  severity: 'P1',
  category: 'billing',
  requiredProof:
    'Test that: (1) exhausts a billing limit, (2) attempts to exceed via API, ' +
    '(3) server rejects with billing error, not just client UI.',
};

/**
 * @deprecated ANALYTICS.SCHEMA.STABLE removed per audit - low signal, hard to detect meaningfully.
 * Keeping the definition for backwards compatibility but not including in checkers.
 */
export const ANALYTICS_SCHEMA_STABLE: InvariantDefinition = {
  id: 'ANALYTICS.SCHEMA.STABLE',
  name: 'Analytics Schema Validation (Deprecated)',
  description:
    'DEPRECATED: This invariant has been removed from active checking. ' +
    'Analytics events must have validated, versioned schemas. ' +
    'Sending malformed events corrupts analytics data and breaks dashboards.',
  severity: 'P2', // Downgraded
  category: 'analytics',
  requiredProof:
    'Analytics track calls use schema validation (zod, io-ts, etc.). ' +
    'Event schemas are versioned and validated before sending.',
};

export const TESTS_NO_FALSE_CONFIDENCE: InvariantDefinition = {
  id: 'TESTS.NO_FALSE_CONFIDENCE',
  name: 'No False Confidence in Tests',
  description:
    'Tests must not give false confidence through: sleeps (timing-dependent), ' +
    'permissive assertions (200 || 201), silent skips, or mocking the function under test.',
  severity: 'P1',
  category: 'tests',
  requiredProof:
    'No test files contain: setTimeout/sleep, status code ORs, ' +
    'test.skip without TODO/ticket, or mocks that replace the tested function.',
};

export const DATAFLOW_UNTRUSTED_FILE_ACCESS: InvariantDefinition = {
  id: 'DATAFLOW.UNTRUSTED.FILE_ACCESS',
  name: 'Untrusted Input in File Access',
  description:
    'Untrusted input used in file paths can lead to path traversal or file overwrite. ' +
    'File reads/writes must be restricted to safe, normalized paths.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Test that path traversal attempts (e.g., "../") are rejected and only allowlisted paths are accessed.',
};

export const DATAFLOW_UNTRUSTED_RESPONSE: InvariantDefinition = {
  id: 'DATAFLOW.UNTRUSTED.RESPONSE',
  name: 'Untrusted Input in Redirects/HTML Responses',
  description:
    'User input must not flow into redirects or HTML responses without validation or sanitization. ' +
    'This can cause open redirects or XSS.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Test that redirects only allow approved domains/paths and that HTML output is sanitized. ' +
    'Include a regression test with malicious input.',
};

// ============================================================================
// P1 - Security Configuration
// ============================================================================

export const CORS_WILDCARD_ORIGIN: InvariantDefinition = {
  id: 'CORS.WILDCARD.ORIGIN',
  name: 'CORS Allows All Origins',
  description:
    'CORS configuration allows requests from any origin (origin: "*" or origin: true). ' +
    'This permits any website to make authenticated requests to your API.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Verify CORS origin is restricted to specific allowed domains, not wildcards.',
};

export const CORS_CREDENTIALS_WILDCARD: InvariantDefinition = {
  id: 'CORS.CREDENTIALS.WILDCARD',
  name: 'CORS Credentials with Wildcard Origin',
  description:
    'CORS allows credentials (cookies, auth headers) with a permissive origin policy. ' +
    'This is a critical misconfiguration that enables credential theft.',
  severity: 'P0',
  category: 'config',
  requiredProof:
    'Verify that credentials: true is only used with specific origin domains.',
};

export const CRYPTO_WEAK_ALGORITHM: InvariantDefinition = {
  id: 'CRYPTO.WEAK.ALGORITHM',
  name: 'Weak Cryptographic Algorithm',
  description:
    'Code uses weak cryptographic algorithms (MD5, SHA1, DES, RC4) that are ' +
    'cryptographically broken and should not be used for security purposes.',
  severity: 'P1',
  category: 'crypto',
  requiredProof:
    'Replace weak algorithms with secure alternatives (SHA-256+, AES-256, etc.).',
};

export const CRYPTO_INSECURE_RANDOM: InvariantDefinition = {
  id: 'CRYPTO.INSECURE.RANDOM',
  name: 'Insecure Random Number Generation',
  description:
    'Math.random() is used in a security-sensitive context. Math.random() is not ' +
    'cryptographically secure and should not be used for tokens, keys, or secrets.',
  severity: 'P1',
  category: 'crypto',
  requiredProof:
    'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive random values.',
};

export const LOGGING_SENSITIVE_DATA: InvariantDefinition = {
  id: 'LOGGING.SENSITIVE.DATA',
  name: 'Sensitive Data in Logs',
  description:
    'Sensitive data (passwords, tokens, API keys) is being logged. This can expose ' +
    'credentials in log files, monitoring systems, and error tracking services.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Remove or redact sensitive fields before logging. Use structured logging with field filtering.',
};

export const JWT_NO_EXPIRY: InvariantDefinition = {
  id: 'JWT.NO.EXPIRY',
  name: 'JWT Without Expiration',
  description:
    'JWT tokens are signed without an expiration claim (exp). Tokens without expiry ' +
    'remain valid indefinitely, increasing the impact of token theft.',
  severity: 'P1',
  category: 'auth',
  requiredProof:
    'All JWT sign operations must include an expiresIn option or exp claim in payload.',
};

export const JWT_WEAK_VERIFICATION: InvariantDefinition = {
  id: 'JWT.WEAK.VERIFICATION',
  name: 'JWT Weak or Missing Verification',
  description:
    'JWT verification does not enforce algorithm restrictions, potentially allowing ' +
    '"none" algorithm attacks or algorithm confusion attacks.',
  severity: 'P0',
  category: 'auth',
  requiredProof:
    'JWT verify must specify explicit algorithms array and reject "none" algorithm.',
};

export const GRAPHQL_INTROSPECTION_ENABLED: InvariantDefinition = {
  id: 'GRAPHQL.INTROSPECTION.ENABLED',
  name: 'GraphQL Introspection in Production',
  description:
    'GraphQL introspection is enabled, exposing the entire API schema. This helps ' +
    'attackers understand your API structure and find potential vulnerabilities.',
  severity: 'P2',
  category: 'config',
  requiredProof:
    'Disable introspection in production: introspection: process.env.NODE_ENV !== "production"',
};

export const GRAPHQL_NO_DEPTH_LIMIT: InvariantDefinition = {
  id: 'GRAPHQL.NO.DEPTH_LIMIT',
  name: 'GraphQL No Query Depth Limit',
  description:
    'GraphQL API does not limit query depth, allowing deeply nested queries that ' +
    'can cause denial of service through resource exhaustion.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Implement query depth limiting using graphql-depth-limit or similar middleware.',
};

export const RATE_LIMIT_MISSING: InvariantDefinition = {
  id: 'RATE_LIMIT.MISSING',
  name: 'Missing Rate Limiting',
  description:
    'Sensitive endpoints (auth, API) lack rate limiting, enabling brute force attacks, ' +
    'credential stuffing, and denial of service.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Implement rate limiting on authentication endpoints and sensitive API routes.',
};

export const DEBUG_ENDPOINTS_EXPOSED: InvariantDefinition = {
  id: 'DEBUG.ENDPOINTS.EXPOSED',
  name: 'Debug Endpoints Exposed',
  description:
    'Debug or development endpoints are accessible in production. These endpoints ' +
    'may expose sensitive information or provide unauthorized functionality.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Debug endpoints should be disabled or protected in production environments.',
};

// ============================================================================
// P0/P1 - XSS & Injection
// ============================================================================

export const XSS_DOM_SINK: InvariantDefinition = {
  id: 'XSS.DOM.SINK',
  name: 'XSS via DOM Sink',
  description:
    'User input flows to dangerous DOM sinks (innerHTML, outerHTML, document.write, ' +
    'dangerouslySetInnerHTML). This can lead to cross-site scripting attacks.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Sanitize all user input before inserting into DOM. Use textContent instead of innerHTML.',
};

export const XSS_TEMPLATE_INJECTION: InvariantDefinition = {
  id: 'XSS.TEMPLATE.INJECTION',
  name: 'XSS via Template Injection',
  description:
    'User input is interpolated into templates or JSX without proper escaping. ' +
    'Template engines may not auto-escape in all contexts.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Use framework auto-escaping, avoid raw HTML interpolation, sanitize user content.',
};

export const NOSQL_INJECTION: InvariantDefinition = {
  id: 'NOSQL.INJECTION',
  name: 'NoSQL Injection',
  description:
    'User input flows to NoSQL queries (MongoDB, Firestore, DynamoDB) without validation. ' +
    'Attackers can modify query logic or access unauthorized data.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Validate and sanitize all query parameters. Use parameterized queries where available.',
};

export const HEADER_INJECTION: InvariantDefinition = {
  id: 'HEADER.INJECTION',
  name: 'HTTP Header Injection',
  description:
    'User input flows to HTTP response headers without sanitization. ' +
    'CRLF injection can lead to response splitting and cache poisoning.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Strip newlines and carriage returns from all header values derived from user input.',
};

export const OPEN_REDIRECT: InvariantDefinition = {
  id: 'REDIRECT.OPEN',
  name: 'Open Redirect',
  description:
    'User input controls redirect destination without validation. ' +
    'Attackers can redirect users to malicious sites for phishing.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Validate redirect URLs against an allowlist of domains or use relative paths only.',
};

export const DESERIALIZATION_UNSAFE: InvariantDefinition = {
  id: 'DESERIALIZATION.UNSAFE',
  name: 'Unsafe Deserialization',
  description:
    'User input is deserialized without validation (JSON.parse with reviver, YAML.load, ' +
    'pickle, etc.). Can lead to code execution or prototype pollution.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Use safe deserialization methods, validate schema before processing.',
};

export const PROTOTYPE_POLLUTION: InvariantDefinition = {
  id: 'PROTOTYPE.POLLUTION',
  name: 'Prototype Pollution',
  description:
    'User input can modify Object.prototype through deep merge, object assignment, ' +
    'or property access. Can lead to security bypasses or code execution.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Block __proto__, constructor, prototype keys. Use Object.create(null) for untrusted data.',
};

export const EVAL_USER_INPUT: InvariantDefinition = {
  id: 'EVAL.USER_INPUT',
  name: 'Eval with User Input',
  description:
    'User input flows to eval(), Function(), setTimeout/setInterval with string, ' +
    'or vm.runInContext. Direct code execution vulnerability.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Never use eval with user input. Use safe alternatives like JSON.parse for data.',
};

export const REGEX_DOS: InvariantDefinition = {
  id: 'REGEX.DOS',
  name: 'Regular Expression DoS (ReDoS)',
  description:
    'Regex patterns with catastrophic backtracking used on user input. ' +
    'Malicious input can cause exponential time complexity.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Audit regex for nested quantifiers. Use regex timeout or safe-regex library.',
};

// ============================================================================
// P1 - Session & Cookie Security
// ============================================================================

export const SESSION_NO_HTTPONLY: InvariantDefinition = {
  id: 'SESSION.COOKIE.NO_HTTPONLY',
  name: 'Session Cookie Missing HttpOnly',
  description:
    'Session cookies without HttpOnly flag can be accessed by JavaScript. ' +
    'XSS attacks can steal session tokens.',
  severity: 'P1',
  category: 'session',
  requiredProof:
    'Set httpOnly: true on all session and authentication cookies.',
};

export const SESSION_NO_SECURE: InvariantDefinition = {
  id: 'SESSION.COOKIE.NO_SECURE',
  name: 'Session Cookie Missing Secure Flag',
  description:
    'Session cookies without Secure flag are transmitted over HTTP. ' +
    'Network attackers can intercept session tokens.',
  severity: 'P1',
  category: 'session',
  requiredProof:
    'Set secure: true on all session cookies in production.',
};

export const SESSION_NO_SAMESITE: InvariantDefinition = {
  id: 'SESSION.COOKIE.NO_SAMESITE',
  name: 'Session Cookie Missing SameSite',
  description:
    'Session cookies without SameSite are sent on cross-site requests. ' +
    'Enables CSRF attacks.',
  severity: 'P1',
  category: 'session',
  requiredProof:
    'Set sameSite: "Strict" or "Lax" on session cookies.',
};

export const SESSION_FIXATION: InvariantDefinition = {
  id: 'SESSION.FIXATION',
  name: 'Session Fixation',
  description:
    'Session ID is not regenerated after authentication. ' +
    'Attackers can fix a session ID before login and hijack after.',
  severity: 'P1',
  category: 'session',
  requiredProof:
    'Regenerate session ID after successful authentication.',
};

// ============================================================================
// P0/P1 - Phase 2: Extended Dataflow Sinks
// ============================================================================

export const LDAP_INJECTION: InvariantDefinition = {
  id: 'LDAP.INJECTION',
  name: 'LDAP Injection',
  description:
    'User input flows to LDAP query without sanitization. ' +
    'Attackers can modify LDAP queries to bypass authentication or access unauthorized data.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Escape special LDAP characters or use parameterized queries.',
};

export const XML_INJECTION: InvariantDefinition = {
  id: 'XML.INJECTION',
  name: 'XML Injection',
  description:
    'User input flows to XML parser without sanitization. ' +
    'Can lead to XML External Entity (XXE) attacks or data manipulation.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Disable external entities and DTDs. Validate XML input against schema.',
};

export const XXE_EXTERNAL_ENTITY: InvariantDefinition = {
  id: 'XXE.EXTERNAL_ENTITY',
  name: 'XML External Entity (XXE)',
  description:
    'XML parser processes external entities from user input. ' +
    'Enables file disclosure, SSRF, and denial of service.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Disable external entities: parser.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)',
};

export const SSTI_INJECTION: InvariantDefinition = {
  id: 'SSTI.INJECTION',
  name: 'Server-Side Template Injection',
  description:
    'User input flows to server-side template engine. ' +
    'Attackers can execute arbitrary code through template syntax.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Never pass user input as template code. Use sandboxed template contexts.',
};

export const LOG_INJECTION: InvariantDefinition = {
  id: 'LOG.INJECTION',
  name: 'Log Injection (Log Forging)',
  description:
    'User input flows to log statements without sanitization. ' +
    'Attackers can inject fake log entries or exploit log viewers.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Sanitize newlines and control characters from log inputs.',
};

export const EMAIL_HEADER_INJECTION: InvariantDefinition = {
  id: 'EMAIL.HEADER_INJECTION',
  name: 'Email Header Injection',
  description:
    'User input flows to email headers (To, CC, BCC, Subject). ' +
    'Attackers can inject additional recipients or modify email content.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Validate email addresses and strip newlines from header values.',
};

export const PDF_INJECTION: InvariantDefinition = {
  id: 'PDF.INJECTION',
  name: 'PDF Injection',
  description:
    'User input flows to PDF generation without sanitization. ' +
    'Can lead to XSS in PDF viewers or malicious PDF content.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Sanitize user input before PDF generation. Use safe PDF libraries.',
};

export const CSV_INJECTION: InvariantDefinition = {
  id: 'CSV.INJECTION',
  name: 'CSV Injection (Formula Injection)',
  description:
    'User input flows to CSV export starting with =, +, -, @. ' +
    'When opened in Excel, formulas can execute arbitrary commands.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Prefix cells starting with formula characters with single quote.',
};

export const GRAPHQL_QUERY_INJECTION: InvariantDefinition = {
  id: 'GRAPHQL.QUERY_INJECTION',
  name: 'GraphQL Query Injection',
  description:
    'User input used to build GraphQL queries dynamically. ' +
    'Attackers can modify query structure or access unauthorized fields.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Use GraphQL variables for user input, never string concatenation.',
};

export const ORM_RAW_QUERY: InvariantDefinition = {
  id: 'ORM.RAW_QUERY',
  name: 'ORM Raw Query Injection',
  description:
    'User input flows to ORM raw query methods (Prisma.$queryRaw, Drizzle sql``). ' +
    'Bypasses ORM protections and enables SQL injection.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Use parameterized queries: $queryRaw`SELECT * FROM users WHERE id = ${id}`',
};

export const SHELL_EXPANSION: InvariantDefinition = {
  id: 'SHELL.EXPANSION',
  name: 'Shell Expansion Injection',
  description:
    'User input flows to shell with backticks, $(), or glob patterns. ' +
    'Enables command injection through shell expansion.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Use execFile instead of exec. Avoid shell: true option.',
};

export const SSRF_URL: InvariantDefinition = {
  id: 'SSRF.URL',
  name: 'Server-Side Request Forgery (SSRF)',
  description:
    'User input controls URL in server-side HTTP request (fetch, axios). ' +
    'Attackers can access internal services, cloud metadata, or scan networks.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Validate URLs against allowlist. Block private IP ranges and cloud metadata endpoints.',
};

// ============================================================================
// P0/P1 - Phase 3: Authorization Deep Analysis
// ============================================================================

export const IDOR_SEQUENTIAL_ID: InvariantDefinition = {
  id: 'IDOR.SEQUENTIAL_ID',
  name: 'IDOR with Sequential IDs',
  description:
    'Resource accessed by sequential/predictable ID without ownership verification. ' +
    'Attackers can enumerate IDs to access other users resources.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Verify resource ownership before access. Use tenant-scoped queries.',
};

export const IDOR_UUID_NO_AUTH: InvariantDefinition = {
  id: 'IDOR.UUID_NO_AUTH',
  name: 'IDOR with UUID (No Authorization)',
  description:
    'Resource accessed by UUID without authorization check. ' +
    'While UUIDs are hard to guess, leaked UUIDs enable unauthorized access.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Always verify authorization even with UUIDs. UUIDs are not secrets.',
};

export const ROLE_ESCALATION_SELF: InvariantDefinition = {
  id: 'AUTHZ.ROLE_ESCALATION_SELF',
  name: 'Self Role Escalation',
  description:
    'User can modify their own role/permissions through API. ' +
    'Missing server-side validation allows privilege escalation.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Prevent users from modifying own roles. Require admin approval for role changes.',
};

export const ADMIN_NO_ROLE_CHECK: InvariantDefinition = {
  id: 'AUTHZ.ADMIN_NO_ROLE_CHECK',
  name: 'Admin Route Without Role Check',
  description:
    'Admin routes/endpoints accessible without role verification. ' +
    'Authentication alone is insufficient - role must be checked.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Check role === "admin" or hasPermission("admin") on all admin routes.',
};

export const MIDDLEWARE_ORDER_BYPASS: InvariantDefinition = {
  id: 'AUTHZ.MIDDLEWARE_ORDER_BYPASS',
  name: 'Auth Middleware Order Bypass',
  description:
    'Auth middleware registered after route handlers, or route defined before middleware. ' +
    'Request processed before authentication check.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Register auth middleware before route handlers. Verify middleware order in tests.',
};

export const OPTIONAL_AUTH_DATA_LEAK: InvariantDefinition = {
  id: 'AUTHZ.OPTIONAL_AUTH_DATA_LEAK',
  name: 'Data Leak with Optional Auth',
  description:
    'Endpoint returns full data when auth is optional, regardless of authentication status. ' +
    'Sensitive fields exposed to unauthenticated users.',
  severity: 'P1',
  category: 'authz',
  requiredProof:
    'Filter response fields based on authentication status. Return minimal data to anonymous users.',
};

export const GRAPHQL_FIELD_NO_AUTH: InvariantDefinition = {
  id: 'GRAPHQL.FIELD_NO_AUTH',
  name: 'GraphQL Field Without Authorization',
  description:
    'GraphQL field resolvers return data without authorization check. ' +
    'Sensitive fields accessible through schema introspection.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Add authorization to each resolver or use schema directives for field-level auth.',
};

export const TRPC_PUBLIC_MUTATION: InvariantDefinition = {
  id: 'TRPC.PUBLIC_MUTATION',
  name: 'tRPC Public Mutation',
  description:
    'tRPC mutation uses publicProcedure instead of protectedProcedure. ' +
    'State-changing operations accessible without authentication.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Use protectedProcedure for all mutations. Only queries may be public.',
};

export const NEXTJS_API_UNPROTECTED: InvariantDefinition = {
  id: 'NEXTJS.API_UNPROTECTED',
  name: 'Next.js API Route Unprotected',
  description:
    'Next.js API route handler lacks authentication check. ' +
    'API endpoints accessible to anyone without login.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Add getServerSession or auth() check at start of handler. Return 401 if unauthenticated.',
};

export const EXPRESS_ROUTE_NO_AUTH: InvariantDefinition = {
  id: 'EXPRESS.ROUTE_NO_AUTH',
  name: 'Express Route Missing Auth Middleware',
  description:
    'Express route defined without auth middleware in chain. ' +
    'Protected route accessible without authentication.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Add auth middleware to route: router.get("/resource", authMiddleware, handler)',
};

export const PERMISSION_CHECK_CACHED: InvariantDefinition = {
  id: 'AUTHZ.PERMISSION_CACHED_TTL',
  name: 'Permission Check Cached Beyond TTL',
  description:
    'Permission/role cached without invalidation on change. ' +
    'Revoked permissions remain active until cache expires.',
  severity: 'P1',
  category: 'authz',
  requiredProof:
    'Invalidate permission cache on role change. Use short TTL or event-driven invalidation.',
};

export const OWNERSHIP_NOT_VERIFIED: InvariantDefinition = {
  id: 'AUTHZ.OWNERSHIP_NOT_VERIFIED',
  name: 'Resource Ownership Not Verified',
  description:
    'Resource fetched by ID without verifying current user owns it. ' +
    'Direct object reference allows cross-user data access.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Add WHERE userId = currentUser.id or tenantId = currentTenant.id to all queries.',
};

export const SOFT_DELETE_BYPASS: InvariantDefinition = {
  id: 'DATA.SOFT_DELETE_BYPASS',
  name: 'Soft Delete Bypass',
  description:
    'Queries return soft-deleted records without filtering. ' +
    'Deleted data accessible through API or other users can see deleted content.',
  severity: 'P1',
  category: 'authz',
  requiredProof:
    'Add deletedAt IS NULL to all queries. Use Prisma middleware or ORM soft-delete plugin.',
};

// ============================================================================
// P0/P1 - Phase 4: Business Logic
// ============================================================================

export const PAYMENT_NO_IDEMPOTENCY: InvariantDefinition = {
  id: 'PAYMENT.NO_IDEMPOTENCY',
  name: 'Payment Without Idempotency Key',
  description:
    'Payment processing without idempotency key. ' +
    'Network retries or user double-clicks can cause duplicate charges.',
  severity: 'P0',
  category: 'business-logic',
  requiredProof:
    'Use idempotency keys for all payment operations. Store and check key before processing.',
};

export const PAYMENT_CLIENT_AMOUNT: InvariantDefinition = {
  id: 'PAYMENT.CLIENT_AMOUNT',
  name: 'Payment Amount From Client',
  description:
    'Payment amount controlled by client-side code. ' +
    'Attackers can modify request to pay less or nothing.',
  severity: 'P0',
  category: 'business-logic',
  requiredProof:
    'Calculate payment amount server-side from cart/order. Never trust client-provided amounts.',
};

export const RACE_CONDITION_BALANCE: InvariantDefinition = {
  id: 'RACE.BALANCE_CHECK',
  name: 'Balance Check Race Condition',
  description:
    'Balance check and deduction not atomic. ' +
    'Concurrent requests can overdraw balance (double-spend).',
  severity: 'P0',
  category: 'business-logic',
  requiredProof:
    'Use database transactions with row locking: SELECT FOR UPDATE or atomic decrement.',
};

export const RACE_CONDITION_INVENTORY: InvariantDefinition = {
  id: 'RACE.INVENTORY_CHECK',
  name: 'Inventory Check Race Condition',
  description:
    'Stock check and decrement not atomic. ' +
    'Concurrent orders can oversell inventory.',
  severity: 'P0',
  category: 'business-logic',
  requiredProof:
    'Use optimistic locking or atomic decrement: UPDATE ... SET stock = stock - 1 WHERE stock > 0.',
};

export const STATE_MACHINE_SKIP: InvariantDefinition = {
  id: 'STATE.TRANSITION_SKIP',
  name: 'State Machine Transition Skip',
  description:
    'State transitions can skip intermediate states. ' +
    'Business rules can be bypassed by jumping directly to final state.',
  severity: 'P1',
  category: 'business-logic',
  requiredProof:
    'Validate allowed transitions: only permit currentState -> nextState pairs defined in state machine.',
};

export const FEATURE_FLAG_CLIENT: InvariantDefinition = {
  id: 'FEATURE.FLAG_CLIENT_CONTROLLED',
  name: 'Feature Flag Controlled by Client',
  description:
    'Feature flags can be overridden by client request. ' +
    'Premium features accessible without payment.',
  severity: 'P1',
  category: 'business-logic',
  requiredProof:
    'Evaluate feature flags server-side only. Never accept flag values from client.',
};

export const TRIAL_BYPASS: InvariantDefinition = {
  id: 'BILLING.TRIAL_BYPASS',
  name: 'Trial Period Bypass',
  description:
    'Trial/subscription status checked client-side or bypassable. ' +
    'Free access to paid features after trial expires.',
  severity: 'P1',
  category: 'business-logic',
  requiredProof:
    'Check subscription status server-side on every request. Return 402/403 if expired.',
};

export const RATE_LIMIT_BYPASS: InvariantDefinition = {
  id: 'RATE_LIMIT.PER_ENDPOINT',
  name: 'Rate Limit Bypass (Per-Endpoint)',
  description:
    'Rate limiting applied per-endpoint instead of per-user. ' +
    'Attackers can use multiple endpoints or rotate IPs.',
  severity: 'P1',
  category: 'business-logic',
  requiredProof:
    'Apply rate limits per authenticated user, not just per IP or endpoint.',
};

export const EMAIL_VERIFICATION_SKIP: InvariantDefinition = {
  id: 'AUTH.EMAIL_VERIFICATION_SKIP',
  name: 'Email Verification Skippable',
  description:
    'Sensitive actions allowed without email verification. ' +
    'Accounts with unverified emails can access full functionality.',
  severity: 'P1',
  category: 'business-logic',
  requiredProof:
    'Require verified email for sensitive actions: payments, settings changes, data exports.',
};

export const MFA_BYPASS: InvariantDefinition = {
  id: 'AUTH.MFA_BYPASS',
  name: 'MFA Bypass Possible',
  description:
    'Multi-factor authentication can be skipped in flow. ' +
    'Direct API access or flow manipulation bypasses MFA.',
  severity: 'P0',
  category: 'business-logic',
  requiredProof:
    'Enforce MFA check on all authenticated endpoints, not just login page.',
};

export const INVITE_TOKEN_REUSE: InvariantDefinition = {
  id: 'AUTH.INVITE_TOKEN_REUSE',
  name: 'Invite Token Reusable',
  description:
    'Invitation tokens can be used multiple times. ' +
    'Single invite link creates unlimited accounts.',
  severity: 'P1',
  category: 'business-logic',
  requiredProof:
    'Mark invite token as used after first successful registration. Delete or expire token.',
};

export const PASSWORD_RESET_NO_EXPIRE: InvariantDefinition = {
  id: 'AUTH.PASSWORD_RESET_NO_EXPIRE',
  name: 'Password Reset Token No Expiration',
  description:
    'Password reset tokens never expire. ' +
    'Old leaked tokens remain valid indefinitely.',
  severity: 'P1',
  category: 'business-logic',
  requiredProof:
    'Set token expiration (15-60 minutes). Check expiration before allowing password change.',
};

// ============================================================================
// P0/P1 - Phase 5: Framework-Specific
// ============================================================================

export const NEXTJS_SSR_SECRET_LEAK: InvariantDefinition = {
  id: 'NEXTJS.SSR_SECRET_LEAK',
  name: 'Next.js SSR Secret Leak',
  description:
    'Secrets or sensitive data returned from getServerSideProps/getStaticProps. ' +
    'Props are serialized to HTML and visible in page source.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Never return secrets in props. Use getServerSideProps for auth, but filter response data.',
};

export const NEXTJS_MIDDLEWARE_BYPASS: InvariantDefinition = {
  id: 'NEXTJS.MIDDLEWARE_BYPASS',
  name: 'Next.js Middleware Bypass',
  description:
    'Next.js middleware matcher config does not cover all protected routes. ' +
    'Routes outside matcher pattern bypass authentication.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Ensure middleware matcher covers all protected routes. Use negative matching for public routes.',
};

export const NEXTJS_ISR_REVALIDATE_AUTH: InvariantDefinition = {
  id: 'NEXTJS.ISR_REVALIDATE_AUTH',
  name: 'Next.js ISR Ignores Auth',
  description:
    'ISR (Incremental Static Regeneration) caches authenticated content. ' +
    'Revalidated pages may show one users data to another.',
  severity: 'P0',
  category: 'cache',
  requiredProof:
    'Do not use ISR for authenticated pages. Use SSR or client-side fetching for user-specific data.',
};

export const REACT_DANGEROUSLY_SET_USER_DATA: InvariantDefinition = {
  id: 'REACT.DANGEROUSLY_SET_USER_DATA',
  name: 'React dangerouslySetInnerHTML with User Data',
  description:
    'User-controlled data passed to dangerouslySetInnerHTML. ' +
    'Enables XSS attacks through injected HTML/scripts.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Sanitize HTML with DOMPurify before using dangerouslySetInnerHTML. Prefer textContent.',
};

export const PRISMA_RAW_INTERPOLATION: InvariantDefinition = {
  id: 'PRISMA.RAW_INTERPOLATION',
  name: 'Prisma Raw Query String Interpolation',
  description:
    'String interpolation used in Prisma $queryRaw/$executeRaw. ' +
    'Bypasses Prisma protections and enables SQL injection.',
  severity: 'P0',
  category: 'dataflow',
  requiredProof:
    'Use tagged template: $queryRaw`SELECT * FROM users WHERE id = ${id}`. Never use string concat.',
};

export const PRISMA_SELECT_ALL_EXPOSURE: InvariantDefinition = {
  id: 'PRISMA.SELECT_ALL_EXPOSURE',
  name: 'Prisma findMany Without Select',
  description:
    'Prisma findMany returns all columns including sensitive fields. ' +
    'Passwords, tokens, or internal fields may be exposed in API responses.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Use select to explicitly choose returned fields. Never return password hashes or tokens.',
};

export const TRPC_ERROR_LEAK: InvariantDefinition = {
  id: 'TRPC.ERROR_LEAK',
  name: 'tRPC Internal Error Leak',
  description:
    'tRPC exposes internal error details to client. ' +
    'Stack traces, SQL errors, or internal paths visible to attackers.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Use onError to sanitize errors. Return generic messages for INTERNAL_SERVER_ERROR.',
};

export const EXPRESS_TRUST_PROXY: InvariantDefinition = {
  id: 'EXPRESS.TRUST_PROXY',
  name: 'Express Trust Proxy Misconfigured',
  description:
    'Express trust proxy set to true without proper network configuration. ' +
    'Attackers can spoof IP addresses via X-Forwarded-For header.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Set trust proxy to specific values (loopback, linklocal, uniquelocal) or number of hops.',
};

export const EXPRESS_STATIC_DOTFILES: InvariantDefinition = {
  id: 'EXPRESS.STATIC_DOTFILES',
  name: 'Express Static Serves Dotfiles',
  description:
    'Express static middleware configured to serve dotfiles. ' +
    'May expose .env, .git, .htaccess, or other sensitive files.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Set dotfiles: "deny" or "ignore" in express.static options.',
};

export const SOCKETIO_NO_AUTH: InvariantDefinition = {
  id: 'SOCKETIO.NO_AUTH',
  name: 'Socket.IO Connection Without Auth',
  description:
    'Socket.IO accepts connections without authentication. ' +
    'Unauthenticated users can subscribe to events or emit messages.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Verify JWT or session in connection middleware. Reject unauthenticated sockets.',
};

export const GRAPHQL_BATCHING_DOS: InvariantDefinition = {
  id: 'GRAPHQL.BATCHING_DOS',
  name: 'GraphQL Batching Without Limits',
  description:
    'GraphQL allows query batching without limit. ' +
    'Attackers can send thousands of queries in single request for DoS.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Limit batch size using middleware or disable batching. Set maxBatchSize config.',
};

export const APOLLO_PERSISTED_BYPASS: InvariantDefinition = {
  id: 'APOLLO.PERSISTED_BYPASS',
  name: 'Apollo Persisted Queries Bypassable',
  description:
    'Apollo persisted queries can be bypassed by sending full query. ' +
    'Attackers can execute arbitrary queries despite persisted-only config.',
  severity: 'P1',
  category: 'config',
  requiredProof:
    'Enable onlyPersisted mode and reject non-persisted queries in production.',
};

export const REMIX_LOADER_NO_AUTH: InvariantDefinition = {
  id: 'REMIX.LOADER_NO_AUTH',
  name: 'Remix Loader Without Auth Check',
  description:
    'Remix loader returns data without authentication check. ' +
    'Sensitive data accessible by navigating directly to route.',
  severity: 'P0',
  category: 'authz',
  requiredProof:
    'Check session in loader. Redirect to login or throw 401 if unauthenticated.',
};

// ============================================================================
// P0/P1 - Phase 6: Crypto & Secrets
// ============================================================================

export const CRYPTO_ECB_MODE: InvariantDefinition = {
  id: 'CRYPTO.ECB_MODE',
  name: 'ECB Mode Encryption',
  description:
    'ECB (Electronic Codebook) mode encrypts identical plaintext blocks to identical ciphertext. ' +
    'Patterns in data are preserved, making it unsuitable for most uses.',
  severity: 'P0',
  category: 'crypto',
  requiredProof:
    'Use CBC, GCM, or CTR mode instead of ECB. GCM provides authenticated encryption.',
};

export const CRYPTO_STATIC_IV: InvariantDefinition = {
  id: 'CRYPTO.STATIC_IV',
  name: 'Static or Predictable IV',
  description:
    'Initialization vector (IV) is static, hardcoded, or predictable. ' +
    'Reusing IVs breaks security guarantees of block cipher modes.',
  severity: 'P0',
  category: 'crypto',
  requiredProof:
    'Generate random IV for each encryption: crypto.randomBytes(16). Never reuse IVs.',
};

export const CRYPTO_WEAK_KEY: InvariantDefinition = {
  id: 'CRYPTO.WEAK_KEY',
  name: 'Weak Cryptographic Key Size',
  description:
    'Key size is below recommended minimum (RSA < 2048, AES < 128). ' +
    'Weak keys can be brute-forced or factored.',
  severity: 'P0',
  category: 'crypto',
  requiredProof:
    'Use RSA >= 2048 bits, AES >= 128 bits. Prefer AES-256 and RSA-4096 for long-term security.',
};

export const TIMING_ATTACK_COMPARISON: InvariantDefinition = {
  id: 'CRYPTO.TIMING_ATTACK',
  name: 'Non-Constant-Time Comparison',
  description:
    'Sensitive values compared using === or localeCompare which leak timing information. ' +
    'Attackers can extract secrets byte-by-byte through timing differences.',
  severity: 'P1',
  category: 'crypto',
  requiredProof:
    'Use crypto.timingSafeEqual() for comparing secrets, tokens, and MACs.',
};

export const JWT_NONE_ALGORITHM: InvariantDefinition = {
  id: 'JWT.NONE_ALGORITHM',
  name: 'JWT Accepts None Algorithm',
  description:
    'JWT verification accepts "none" algorithm, allowing unsigned tokens. ' +
    'Attackers can forge valid tokens without the secret key.',
  severity: 'P0',
  category: 'auth',
  requiredProof:
    'Explicitly specify allowed algorithms and reject "none": algorithms: ["HS256", "RS256"]',
};

export const JWT_WEAK_SECRET: InvariantDefinition = {
  id: 'JWT.WEAK_SECRET',
  name: 'JWT Weak Secret',
  description:
    'JWT secret is too short (< 32 characters) or is a common/guessable value. ' +
    'Weak secrets can be brute-forced offline.',
  severity: 'P0',
  category: 'auth',
  requiredProof:
    'Use secrets >= 32 random characters. Generate with: crypto.randomBytes(32).toString("hex")',
};

export const PASSWORD_PLAINTEXT_STORE: InvariantDefinition = {
  id: 'AUTH.PASSWORD_PLAINTEXT',
  name: 'Password Stored Without Hashing',
  description:
    'Password stored in plaintext or with reversible encoding. ' +
    'Database breach exposes all user passwords immediately.',
  severity: 'P0',
  category: 'auth',
  requiredProof:
    'Hash passwords with bcrypt, argon2, or scrypt. Never store plaintext or use reversible encoding.',
};

export const PASSWORD_WEAK_HASH: InvariantDefinition = {
  id: 'AUTH.PASSWORD_WEAK_HASH',
  name: 'Password Hashed with Weak Algorithm',
  description:
    'Password hashed with MD5, SHA1, or SHA256 without iterations. ' +
    'Fast hashes enable rapid brute-force attacks.',
  severity: 'P0',
  category: 'auth',
  requiredProof:
    'Use bcrypt (cost >= 10), argon2id, or scrypt. Never use MD5, SHA1, or plain SHA256.',
};

export const SECRET_IN_ERROR: InvariantDefinition = {
  id: 'ERROR.SECRET_LEAK',
  name: 'Secrets in Error Messages',
  description:
    'Error messages or stack traces contain secrets, credentials, or sensitive data. ' +
    'Errors may be logged, displayed to users, or sent to monitoring services.',
  severity: 'P1',
  category: 'dataflow',
  requiredProof:
    'Sanitize errors before logging or returning. Never include credentials in error messages.',
};

export const KEY_DERIVATION_WEAK: InvariantDefinition = {
  id: 'CRYPTO.KEY_DERIVATION_WEAK',
  name: 'Weak Key Derivation Function',
  description:
    'PBKDF2 with less than 100,000 iterations, or deprecated KDF used. ' +
    'Low iteration counts enable efficient brute-force attacks.',
  severity: 'P1',
  category: 'crypto',
  requiredProof:
    'Use PBKDF2 with >= 100,000 iterations, or prefer argon2id/scrypt for password-based keys.',
};

// ============================================================================
// All Invariants
// ============================================================================

/**
 * Active invariants that have working checkers.
 * ANALYTICS_SCHEMA_STABLE removed per audit - low signal, hard to detect meaningfully.
 */
export const ALL_INVARIANTS: InvariantDefinition[] = [
  // P0 - Critical
  AUTHZ_SERVICE_LAYER_ENFORCED,
  AUTHZ_MEMBERSHIP_REVOCATION_IMMEDIATE,
  AUTHZ_KEYS_REVOCATION_IMMEDIATE,
  WEBHOOK_IDEMPOTENT,
  WEBHOOK_SIGNATURE_VERIFIED,
  TRANSACTION_POST_COMMIT_SIDE_EFFECTS,
  AUTHZ_RLS_MULTI_TENANT,
  AUTHZ_TENANT_ISOLATION,
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
  // Note: ANALYTICS_SCHEMA_STABLE deprecated and removed from active checking
];

export const P0_INVARIANTS = ALL_INVARIANTS.filter((i) => i.severity === 'P0');
export const P1_INVARIANTS = ALL_INVARIANTS.filter((i) => i.severity === 'P1');

export function getInvariantById(id: string): InvariantDefinition | undefined {
  return ALL_INVARIANTS.find((i) => i.id === id);
}

export function getInvariantsByCategory(
  category: InvariantDefinition['category']
): InvariantDefinition[] {
  return ALL_INVARIANTS.filter((i) => i.category === category);
}
