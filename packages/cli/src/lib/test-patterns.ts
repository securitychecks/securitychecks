/**
 * Test Patterns for Development
 *
 * These are real patterns used to test the pattern matching engine without
 * requiring cloud connectivity. Enable via:
 * - SECURITYCHECKS_DEV_PATTERNS=1
 * - scheck run --patterns-file ./patterns.json
 *
 * These patterns exercise all major detection mechanisms:
 * - Code patterns (regex, string matching)
 * - Artifact conditions (service, webhook, transaction)
 * - Context constraints (file-level, function-level)
 */

import type { PatternDefinition } from '@securitychecks/collector';

/**
 * Test patterns for development and testing.
 * These are real patterns that detect actual security issues.
 */
export const TEST_PATTERNS: PatternDefinition[] = [
  // ============================================================================
  // Next.js Patterns
  // ============================================================================
  {
    id: 'nextjs.server-action.unprotected',
    version: '1.0.0',
    invariantId: 'AUTHZ.SERVICE_LAYER.ENFORCED',
    name: 'Unprotected Next.js Server Action',
    description:
      'Server actions with "use server" directive should verify authentication before performing mutations.',
    applicability: {
      frameworks: ['nextjs'],
      requiredDependencies: ['next'],
      filePatterns: ['**/app/**/actions.ts', '**/app/**/actions/*.ts', '**/actions/**/*.ts'],
    },
    detection: {
      artifactConditions: [
        {
          type: 'service',
          conditions: {
            hasDirective: 'use server',
            missingAuthCall: true,
          },
        },
      ],
    },
    finding: {
      severity: 'P0',
      message: 'Server action missing authentication check',
      requiredProof: 'Add getServerSession() or auth() check before any mutations',
      suggestedTest: 'POST to server action without session should return 401/redirect',
      references: [
        'https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations',
      ],
      tags: ['nextjs', 'authz', 'server-actions'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: [
        'https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations',
      ],
    },
  },
  {
    id: 'nextjs.api-route.unprotected',
    version: '1.0.0',
    invariantId: 'AUTHZ.SERVICE_LAYER.ENFORCED',
    name: 'Unprotected Next.js API Route',
    description:
      'API routes should verify authentication for mutating operations (POST, PUT, DELETE, PATCH).',
    applicability: {
      frameworks: ['nextjs'],
      requiredDependencies: ['next'],
      filePatterns: ['**/app/api/**/route.ts', '**/pages/api/**/*.ts'],
    },
    detection: {
      codePatterns: [
        {
          pattern: '/export\\s+(async\\s+)?function\\s+(POST|PUT|DELETE|PATCH)/',
          not: ['getServerSession', 'auth()', 'requireAuth', 'authorize'],
          context: {
            atFileLevel: true,
          },
        },
      ],
    },
    finding: {
      severity: 'P0',
      message: 'API route handler missing authentication check',
      requiredProof: 'Add session/auth check at the start of the handler',
      suggestedTest: 'Request without Authorization header should return 401',
      references: ['https://nextjs.org/docs/app/building-your-application/routing/route-handlers'],
      tags: ['nextjs', 'authz', 'api-routes'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: ['https://nextjs.org/docs/app/building-your-application/routing/route-handlers'],
    },
  },

  // ============================================================================
  // Stripe Webhook Patterns
  // ============================================================================
  {
    id: 'stripe.webhook.no-signature',
    version: '1.0.0',
    invariantId: 'WEBHOOK.SIGNATURE.VERIFIED',
    name: 'Stripe Webhook Missing Signature Verification',
    description:
      'Stripe webhooks must verify signatures using stripe.webhooks.constructEvent() before processing.',
    applicability: {
      frameworks: ['stripe'],
      requiredDependencies: ['stripe'],
      filePatterns: ['**/webhook*/**/*.ts', '**/api/webhook*/**/*.ts', '**/stripe/**/*.ts'],
    },
    detection: {
      artifactConditions: [
        {
          type: 'webhookHandler',
          conditions: {
            provider: 'stripe',
            missingSignatureVerification: true,
          },
        },
      ],
      codePatterns: [
        {
          pattern: 'stripe-signature',
          not: ['constructEvent', 'verifyWebhook'],
          context: {
            atFileLevel: true,
          },
          invert: true, // Flag when pattern is missing
        },
      ],
    },
    finding: {
      severity: 'P0',
      message: 'Stripe webhook handler missing signature verification',
      requiredProof:
        'Use stripe.webhooks.constructEvent(body, sig, webhookSecret) to verify signatures',
      suggestedTest: 'Request with invalid stripe-signature header should return 400',
      references: ['https://stripe.com/docs/webhooks/signatures'],
      tags: ['stripe', 'webhook', 'signature'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: ['https://stripe.com/docs/webhooks/signatures'],
    },
  },
  {
    id: 'stripe.webhook.no-idempotency',
    version: '1.0.0',
    invariantId: 'WEBHOOK.IDEMPOTENT',
    name: 'Stripe Webhook Missing Idempotency',
    description:
      'Stripe webhooks should check if an event has already been processed to handle retries safely.',
    applicability: {
      frameworks: ['stripe'],
      requiredDependencies: ['stripe'],
      filePatterns: ['**/webhook*/**/*.ts', '**/api/webhook*/**/*.ts'],
    },
    detection: {
      artifactConditions: [
        {
          type: 'webhookHandler',
          conditions: {
            provider: 'stripe',
            missingIdempotency: true,
          },
        },
      ],
    },
    finding: {
      severity: 'P0',
      message: 'Stripe webhook handler missing idempotency check',
      requiredProof: 'Store processed event IDs and check before processing',
      suggestedTest: 'Sending the same event twice should only process once',
      references: ['https://stripe.com/docs/webhooks/best-practices#handle-duplicate-events'],
      tags: ['stripe', 'webhook', 'idempotency'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: ['https://stripe.com/docs/webhooks/best-practices'],
    },
  },

  // ============================================================================
  // Prisma Transaction Patterns
  // ============================================================================
  {
    id: 'prisma.transaction.email-inside',
    version: '1.0.0',
    invariantId: 'TRANSACTION.POST_COMMIT.SIDE_EFFECTS',
    name: 'Email Sent Inside Prisma Transaction',
    description:
      'Sending emails inside a transaction can lead to sent emails for rolled-back operations.',
    applicability: {
      frameworks: ['prisma'],
      requiredDependencies: ['@prisma/client'],
      filePatterns: ['**/*.ts'],
    },
    detection: {
      artifactConditions: [
        {
          type: 'transactionScope',
          conditions: {
            containsSideEffects: true,
            sideEffectTypes: ['email'],
          },
        },
      ],
    },
    finding: {
      severity: 'P0',
      message: 'Email side effect inside database transaction',
      requiredProof: 'Move email sending outside the transaction, after commit succeeds',
      suggestedTest:
        'Simulate transaction rollback and verify no email was sent',
      references: [
        'https://www.prisma.io/docs/concepts/components/prisma-client/transactions',
      ],
      tags: ['prisma', 'transaction', 'side-effect'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: ['https://www.prisma.io/docs/concepts/components/prisma-client/transactions'],
    },
  },
  {
    id: 'prisma.transaction.webhook-inside',
    version: '1.0.0',
    invariantId: 'TRANSACTION.POST_COMMIT.SIDE_EFFECTS',
    name: 'External API Call Inside Prisma Transaction',
    description:
      'Calling external APIs inside a transaction can trigger irreversible actions before commit.',
    applicability: {
      frameworks: ['prisma'],
      requiredDependencies: ['@prisma/client'],
      filePatterns: ['**/*.ts'],
    },
    detection: {
      artifactConditions: [
        {
          type: 'transactionScope',
          conditions: {
            containsSideEffects: true,
            sideEffectTypes: ['external_api', 'webhook'],
          },
        },
      ],
    },
    finding: {
      severity: 'P0',
      message: 'External API call inside database transaction',
      requiredProof: 'Move external API calls outside the transaction, after commit',
      suggestedTest: 'Simulate transaction rollback and verify no external call was made',
      references: [
        'https://www.prisma.io/docs/concepts/components/prisma-client/transactions',
      ],
      tags: ['prisma', 'transaction', 'side-effect', 'api'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: ['https://www.prisma.io/docs/concepts/components/prisma-client/transactions'],
    },
  },

  // ============================================================================
  // Express Patterns
  // ============================================================================
  {
    id: 'express.route.no-auth-middleware',
    version: '1.0.0',
    invariantId: 'AUTHZ.SERVICE_LAYER.ENFORCED',
    name: 'Express Route Missing Auth Middleware',
    description:
      'Express routes handling sensitive operations should use authentication middleware.',
    applicability: {
      frameworks: ['express'],
      requiredDependencies: ['express'],
      filePatterns: ['**/routes/**/*.ts', '**/router/**/*.ts', '**/api/**/*.ts'],
    },
    detection: {
      codePatterns: [
        {
          pattern: '/router\\.(post|put|delete|patch)\\s*\\(/',
          not: ['requireAuth', 'isAuthenticated', 'authenticate', 'authMiddleware', 'passport'],
          requiresNearby: {
            within: 5,
            not: ['requireAuth', 'isAuthenticated', 'authenticate', 'authMiddleware'],
          },
        },
      ],
    },
    finding: {
      severity: 'P1',
      message: 'Express route missing authentication middleware',
      requiredProof: 'Add authentication middleware before route handler',
      suggestedTest: 'Request without auth token should return 401',
      references: ['https://expressjs.com/en/guide/using-middleware.html'],
      tags: ['express', 'authz', 'middleware'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: ['https://expressjs.com/en/guide/using-middleware.html'],
    },
  },

  // ============================================================================
  // BullMQ Job Patterns
  // ============================================================================
  {
    id: 'bullmq.job.no-idempotency',
    version: '1.0.0',
    invariantId: 'JOBS.RETRY_SAFE',
    name: 'BullMQ Job Handler Missing Idempotency',
    description:
      'BullMQ job handlers should be idempotent to safely handle retries.',
    applicability: {
      frameworks: ['bullmq'],
      requiredDependencies: ['bullmq'],
      filePatterns: ['**/jobs/**/*.ts', '**/workers/**/*.ts', '**/queues/**/*.ts'],
    },
    detection: {
      codePatterns: [
        {
          pattern: '/new\\s+Worker\\s*\\(/',
          not: ['idempotencyKey', 'processedJobs', 'alreadyProcessed', 'jobId'],
          context: {
            atFileLevel: true,
          },
        },
      ],
    },
    finding: {
      severity: 'P1',
      message: 'BullMQ worker may not be idempotent for retries',
      requiredProof: 'Track processed job IDs or use idempotency keys',
      suggestedTest: 'Running the same job twice should produce the same result',
      references: ['https://docs.bullmq.io/guide/retrying-failing-jobs'],
      tags: ['bullmq', 'jobs', 'idempotency'],
    },
    metadata: {
      author: 'SecurityChecks',
      created: '2026-01-09T00:00:00Z',
      references: ['https://docs.bullmq.io/guide/retrying-failing-jobs'],
    },
  },
];

/**
 * Check if dev patterns should be used.
 */
export function shouldUseDevPatterns(): boolean {
  return process.env['SECURITYCHECKS_DEV_PATTERNS'] === '1' ||
         process.env['SECURITYCHECKS_DEV_PATTERNS'] === 'true';
}

/**
 * Get test patterns filtered by frameworks.
 */
export function getTestPatternsForFrameworks(frameworks: string[]): PatternDefinition[] {
  if (frameworks.length === 0) {
    return TEST_PATTERNS;
  }

  const normalizedFrameworks = frameworks.map(f => f.toLowerCase());
  return TEST_PATTERNS.filter(pattern =>
    pattern.applicability.frameworks.some(f =>
      normalizedFrameworks.includes(f.toLowerCase())
    )
  );
}
