/* eslint-disable max-lines */
/**
 * Webhook Extractor
 *
 * Extracts webhook handler information to verify idempotency patterns.
 * Detects:
 * - Webhook handler functions (Stripe, GitHub, Slack, etc.)
 * - Event ID extraction and storage
 * - Idempotency key patterns
 * - Duplicate event handling
 */

import { SourceFile, Node, CallExpression } from 'ts-morph';
import type { WebhookHandler, WebhookProvider, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

// ============================================================================
// Comment Stripping Utilities
// ============================================================================

/**
 * Strip comments from source text to avoid false positives from TODOs, NOTEs, etc.
 * This ensures we only match patterns in actual code, not documentation.
 */
function stripComments(text: string): string {
  // Remove single-line comments (// ...)
  let result = text.replace(/\/\/[^\n]*/g, '');
  // Remove multi-line comments (/* ... */)
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * Get code-only text from a ts-morph Node by extracting only non-comment content.
 * This is more precise than regex stripping as it uses the AST.
 * @internal Reserved for future use with more sophisticated pattern matching.
 */
function _getCodeOnlyText(_node: Node): string {
  // Reserved for future use - currently using stripComments() instead
  return '';
}

// ============================================================================
// Handler Detection Utilities
// ============================================================================

/**
 * Check if a function looks like an HTTP handler (has req/res parameters).
 */
function hasHandlerSignature(node: Node): boolean {
  let params: string[] = [];

  if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isMethodDeclaration(node)) {
    const paramNodes = node.getParameters?.() ?? [];
    params = paramNodes.map((p) => p.getName().toLowerCase());
  }

  // Check for common handler parameter patterns
  const handlerParams = ['req', 'res', 'request', 'response', 'ctx', 'context', 'event'];
  return params.some((p) => handlerParams.some((hp) => p.includes(hp)));
}

/**
 * Check if a function is exported (top-level export).
 */
function isExported(node: Node): boolean {
  if (Node.isFunctionDeclaration(node)) {
    return node.isExported();
  }

  if (Node.isArrowFunction(node)) {
    const parent = node.getParent();
    if (Node.isVariableDeclaration(parent)) {
      const varStatement = parent.getParent()?.getParent();
      if (Node.isVariableStatement(varStatement)) {
        return varStatement.isExported();
      }
    }
  }

  return false;
}

/**
 * Determine if a function is a webhook handler vs a helper function.
 *
 * Handler heuristics:
 * - Has handler-like signature (req/res/ctx params) → handler
 * - Is exported → handler (API routes, Next.js handlers)
 * - Has strong handler-like name (handleX, onX, POST, GET) → handler
 *
 * Helper heuristics (excluded):
 * - Name starts with "process" (processWebhookPayload → helper)
 * - Not exported, no handler params → likely internal helper
 */
function isWebhookHandler(node: Node, name: string | undefined): boolean {
  if (!name) return false;

  // Handler signature is the strongest indicator
  if (hasHandlerSignature(node)) return true;

  // Exported functions are likely handlers (API routes, entry points)
  if (isExported(node)) return true;

  // Exclude helper patterns BEFORE checking handler name patterns
  // "process" prefix typically indicates a helper function
  const helperPatterns = [
    /^process/i,  // processWebhookPayload, processEvent
  ];
  if (helperPatterns.some((p) => p.test(name))) {
    return false;
  }

  // Strong handler name patterns (only if not a helper)
  const strongHandlerPatterns = [
    /^handle/i,  // handleStripeWebhook, handleGithubEvent
    /^on[A-Z]/,  // onPaymentSuccess, onEventReceived
    /^POST$/,   // Next.js API routes (uppercase only, lowercase 'post' is Meteor/Express route method)
    /^GET$/,
  ];

  return strongHandlerPatterns.some((p) => p.test(name));
}

// Patterns that indicate webhook handlers
// NOTE: Be careful with provider patterns - /stripe/ alone would match /stripe/checkout which is NOT a webhook
const WEBHOOK_ROUTE_PATTERNS = [
  /\/webhooks?\//i,           // /webhook/ or /webhooks/
  /\/hooks\//i,               // /hooks/
  // Provider-specific webhook paths (must include "webhook" or be the known webhook endpoint)
  /\/stripe\/webhook/i,       // /stripe/webhook (not /stripe/checkout)
  /\/github\/webhook/i,       // /github/webhook
  /\/slack\/events/i,         // /slack/events (Slack's webhook endpoint)
  /\/twilio\/webhook/i,       // /twilio/webhook
  /\/sendgrid\/webhook/i,     // /sendgrid/webhook
  /\/lemon-?squeezy\/webhook/i, // /lemonsqueezy/webhook
  /\/paddle\/webhook/i,       // /paddle/webhook
  /\/clerk\/webhook/i,        // /clerk/webhook (not /clerk/callback)
  /\/resend\/webhook/i,       // /resend/webhook
  /\/postmark\/webhook/i,     // /postmark/webhook
  /\/shopify\/webhook/i,      // /shopify/webhook
  /\/square\/webhook/i,       // /square/webhook
  /\/paypal\/webhook/i,       // /paypal/webhook (not /paypal/checkout)
  /\/braintree\/webhook/i,    // /braintree/webhook
  /\/plaid\/webhook/i,        // /plaid/webhook
  /\/intercom\/webhook/i,     // /intercom/webhook
  /\/zendesk\/webhook/i,      // /zendesk/webhook
];

// Files that should NEVER be considered webhook handlers
const NON_WEBHOOK_FILE_PATTERNS = [
  /\/components\//i,        // React components
  /\/hooks\//i,             // React hooks (different from /hooks/ in URLs)
  /\/stores?\//i,           // State stores
  /\.tsx$/i,                // React components (unless they're API routes)
  /\/routers?\//i,          // tRPC routers
  /\/procedures?\//i,       // tRPC procedures
  /\/__tests__\//i,         // Test files
  /\.test\.[tj]sx?$/i,      // Test files
  /\.spec\.[tj]sx?$/i,      // Test files
  /\/lib\/.*(?<!route)\.[tj]s$/i, // Lib files that aren't routes
  /\/test\//i,              // Test directories
  /\/tests\//i,             // Test directories
  /\/fixtures?\//i,         // Test fixtures
  /\/mocks?\//i,            // Mock files
  /\/playwright\//i,        // Playwright tests
  /\/e2e\//i,               // E2E tests
  /\/di\//i,                // Dependency injection modules
  /\/modules\//i,           // DI modules (too broad for webhook endpoints)
  /\/cron\//i,              // Cron job routes (scheduled tasks, not webhooks)
  /\/crons\//i,             // Cron job routes
  // Webhook SENDING/PROCESSING code (not receiving)
  /webhook-queue/i,         // Webhook queue processing
  /webhook-delivery/i,      // Webhook delivery
  /lib\/.*webhook/i,        // Lib webhook utilities (sending, not receiving)
  /trigger-client/i,        // Trigger.dev client (sends webhooks)
  /\/audit\//i,             // Audit logging (uses webhook-like patterns but isn't receiving)
  /\/security\//i,          // Security utilities
  /sentry/i,                // Sentry error reporting
  /\/billing\/portal/i,     // Billing portal redirects
  /\/resend\//i,            // Resend actions (not webhooks)
  // Frontend/UI patterns (2026-01-09 accuracy fix)
  /\/ui\//i,                // UI components
  /\/admin-x-/i,            // Ghost admin framework
  /\/design-system\//i,     // Design system components
  /\/src\/api\//i,          // Frontend API client code (not backend)
  /store_subscribe/i,       // State subscriptions
  /\.client\.[tj]sx?$/i,    // Client-side files
  /\/client\//i,            // Client directory
  /\/frontend\//i,          // Frontend directory
  // Webhook management APIs (CRUD, not receiving)
  /\/api\/v\d+\/webhooks?\/(?:\[|route)/i,  // /api/v1/webhooks/route.ts - management API
  /\/service\/.*webhook/i,  // Webhook service layer (management)
];

// Function name patterns that indicate this is NOT a webhook endpoint handler
const NON_HANDLER_FUNCTION_PATTERNS = [
  // Webhook CRUD operations (management, not receiving)
  /^create.*Webhook/i,      // createWebhook, createWebhookSubscription
  /^delete.*Webhook/i,      // deleteWebhook, deleteAllWebhooks
  /^update.*Webhook/i,      // updateWebhook
  /^get.*Webhook/i,         // getWebhook, getWebhooks
  /^list.*Webhook/i,        // listWebhooks
  /^find.*Webhook/i,        // findWebhook

  // React components and hooks
  /^Webhook[A-Z][a-z]+$/,   // WebhookList, WebhookForm (React components)
  /^use.*Webhook/i,         // useWebhook, useWebhooks (React hooks)
  /Skeleton$/i,             // WebhookListSkeleton (loading states)
  /Provider$/i,             // WebhookProvider
  /Context$/i,              // WebhookContext

  // Helper/utility functions (not endpoints)
  /^validate.*Webhook/i,    // validateWebhookRequest
  /^verify.*Webhook/i,      // verifyWebhookSignature (helper)
  /^construct.*Event/i,     // constructEvent (Stripe helper)
  /Procedure$/i,            // createWebhookPbacProcedure (tRPC)
  /^Webhook[A-Z]\w*$/,      // WebhookHandler, WebhookService (type/class definitions)
  /^on[A-Z]\w+Webhook/i,    // onCreateWebhook, onDeleteWebhook (event handlers)

  // Internal service handlers (called BY the webhook, not the webhook itself)
  /^handle.*Payment/i,      // handleStripePaymentSuccess - internal handler
  /^handle.*Subscription/i, // handleStripeSubscriptionDeleted - internal
  /^handle.*Checkout/i,     // handleStripeCheckoutEvents - internal
  /^handle.*Invoice/i,      // handleStripeInvoice - internal
  /^handle.*Customer/i,     // handleCustomerUpdated - internal
  /^process.*Payment/i,     // processPayment - internal
  /^process.*Subscription/i,// processSubscription - internal
  /^process.*Event/i,       // processEvent - internal (unless it's the entry point)

  // Test helpers and mocks
  /^expect.*Webhook/i,      // expectBookingCreatedWebhookToHaveBeenFired - test helper
  /^mock.*Webhook/i,        // mockPaymentSuccessWebhookFromStripe - test mock
  /^assert.*Webhook/i,      // assertWebhookCalled - test helper
  /^verify.*Webhook/i,      // verifyWebhookSignature - also catches test helpers

  // Webhook SENDING functions (outgoing, not incoming)
  /^send.*Webhook/i,        // sendWebhook, sendWebhookPayload
  /^trigger.*Webhook/i,     // triggerWebhook, triggerFormSubmittedNoEventWebhook
  /^fire.*Webhook/i,        // fireWebhook
  /^dispatch.*Webhook/i,    // dispatchWebhook
  /^emit.*Webhook/i,        // emitWebhook
  /^publish.*Webhook/i,     // publishWebhook

  // Utility functions
  /^revalidate.*Webhook/i,  // revalidateWebhooksList
  /^refresh.*Webhook/i,     // refreshWebhooks
  /^subscribe.*Webhook/i,   // subscribeToWebhook
  /^unsubscribe.*Webhook/i, // unsubscribeFromWebhook

  // Generic function names (too short/ambiguous)
  /^get$/i,                 // Singleton getters
  /^set$/i,
  /^run$/i,
  /^execute$/i,
  /^call$/i,
  /^invoke$/i,
];

// Function/method names that indicate webhook handling
// NOTE: These should match function NAMES, not any occurrence in code
const WEBHOOK_FUNCTION_PATTERNS = [
  /handle.*Webhook/i,         // handleWebhook, handleStripeWebhook, handleSvixWebhook
  /processWebhook/i,          // processWebhook, processStripeWebhook
  /onWebhook/i,               // onWebhook, onStripeWebhook
  /webhookHandler/i,          // webhookHandler
  /handleStripeEvent/i,       // handleStripeEvent
  /handleGithubEvent/i,       // handleGithubEvent
  /handleSlackEvent/i,        // handleSlackEvent
  /handleTwilioEvent/i,       // handleTwilioEvent
  /handleClerkEvent/i,        // handleClerkEvent
  /handleResendEvent/i,       // handleResendEvent
  /handlePaddleEvent/i,       // handlePaddleEvent
  /handleLemonSqueezyEvent/i, // handleLemonSqueezyEvent
  /handleShopifyEvent/i,      // handleShopifyEvent
  /handlePaypalEvent/i,       // handlePaypalEvent
  /handlePlaidEvent/i,        // handlePlaidEvent
  /constructEvent/i,          // Stripe's constructEvent
  /verifyWebhookSignature/i,  // Signature verification
  /^POST$/,                   // Next.js App Router (uppercase only - lowercase 'post' is Meteor/Express route method)
  /^GET$/,                    // Some webhook verification endpoints (uppercase only)
];

// Patterns that indicate idempotency handling
const IDEMPOTENCY_PATTERNS = [
  /event\.?id/i,
  /eventId/i,
  /idempotency/i,
  /idempotent/i,
  /processedEvents/i,
  /processedWebhook/i,
  /eventProcessed/i,
  /alreadyProcessed/i,
  /isDuplicate/i,
  /dedup/i,
  /duplicate:\s*true/i,           // Return early for duplicates
  /if\s*\(\s*processed\s*\)/i,    // if (processed) pattern
  /if\s*\(\s*existing/i,          // if (existingEvent) pattern
  /if\s*\(\s*already/i,           // if (alreadyProcessed) pattern
  /return.*duplicate/i,           // return { duplicate: true }
  /\?\.\s*processed\s*\)/i,       // existingEvent?.processed pattern
  /\.processed\s*===?\s*true/i,   // event.processed === true pattern
  /withLock\s*\(/i,               // withLock() distributed lock pattern
  /acquireLock\s*\(/i,            // acquireLock() pattern
  /\bLock\s*\(/i,                 // Lock() or createLock() patterns
  /mutex\./i,                     // mutex.acquire(), mutex.lock()
];

// Patterns that indicate event ID storage
const EVENT_ID_STORAGE_PATTERNS = [
  /insert.*event/i,
  /create.*event/i,
  /save.*event/i,
  /store.*event/i,
  /redis.*set/i,
  /cache.*set/i,
];

// Event ID extraction patterns by provider
const EVENT_ID_EXTRACTION_PATTERNS: Record<string, Array<{ pattern: RegExp; method: 'stripe_event_id' | 'github_delivery' | 'svix_id' | 'header' | 'body_field' }>> = {
  stripe: [
    { pattern: /event\.id/i, method: 'stripe_event_id' },
    { pattern: /stripeEvent\.id/i, method: 'stripe_event_id' },
  ],
  github: [
    { pattern: /x-github-delivery/i, method: 'github_delivery' },
    { pattern: /delivery.*id/i, method: 'github_delivery' },
  ],
  slack: [
    { pattern: /x-slack-request-timestamp/i, method: 'header' },
    { pattern: /event_id/i, method: 'body_field' },
  ],
  svix: [
    { pattern: /svix-id/i, method: 'svix_id' },
    { pattern: /messageId/i, method: 'svix_id' },
  ],
  // New providers
  clerk: [
    { pattern: /svix-id/i, method: 'svix_id' },  // Clerk uses Svix
    { pattern: /webhook\.id/i, method: 'body_field' },
  ],
  resend: [
    { pattern: /x-resend-webhook-id/i, method: 'header' },
    { pattern: /svix-id/i, method: 'svix_id' },  // Resend uses Svix
  ],
  paddle: [
    { pattern: /event_id/i, method: 'body_field' },
    { pattern: /p-signature/i, method: 'header' },
  ],
  lemonsqueezy: [
    { pattern: /x-event-id/i, method: 'header' },
    { pattern: /meta\.event_id/i, method: 'body_field' },
  ],
  twilio: [
    { pattern: /MessageSid/i, method: 'body_field' },
    { pattern: /AccountSid/i, method: 'body_field' },
    { pattern: /x-twilio-signature/i, method: 'header' },
  ],
  sendgrid: [
    { pattern: /sg_message_id/i, method: 'body_field' },
    { pattern: /sg_event_id/i, method: 'body_field' },
  ],
  postmark: [
    { pattern: /MessageID/i, method: 'body_field' },
    { pattern: /x-postmark-unique-id/i, method: 'header' },
  ],
  shopify: [
    { pattern: /x-shopify-webhook-id/i, method: 'header' },
    { pattern: /x-shopify-order-id/i, method: 'header' },
  ],
  paypal: [
    { pattern: /x-paypal-transmission-id/i, method: 'header' },
    { pattern: /event_id/i, method: 'body_field' },
  ],
  plaid: [
    { pattern: /webhook_code/i, method: 'body_field' },
    { pattern: /item_id/i, method: 'body_field' },
  ],
  generic: [
    { pattern: /x-request-id/i, method: 'header' },
    { pattern: /idempotency-key/i, method: 'header' },
    { pattern: /event\.id/i, method: 'body_field' },
    { pattern: /payload\.id/i, method: 'body_field' },
  ],
};

type SignatureMethod = NonNullable<WebhookHandler['signatureVerification']>['method'];

const SIGNATURE_VERIFICATION_PATTERNS: Record<WebhookProvider, Array<{ pattern: RegExp; method: SignatureMethod }>> = {
  stripe: [
    { pattern: /stripe\.webhooks\.constructEvent/i, method: 'stripe_construct_event' },
    { pattern: /constructEvent/i, method: 'stripe_construct_event' },
  ],
  github: [
    { pattern: /x-hub-signature-256/i, method: 'github_signature' },
    { pattern: /x-hub-signature/i, method: 'github_signature' },
    { pattern: /verifyGithub/i, method: 'github_signature' },
  ],
  slack: [
    { pattern: /x-slack-signature/i, method: 'slack_signature' },
    { pattern: /verifySlack/i, method: 'slack_signature' },
  ],
  svix: [
    { pattern: /svix/i, method: 'svix_verify' },
    { pattern: /Webhook\(/i, method: 'svix_verify' },
  ],
  clerk: [
    { pattern: /svix/i, method: 'svix_verify' },
    { pattern: /Webhook\(/i, method: 'svix_verify' },
  ],
  resend: [
    { pattern: /svix/i, method: 'svix_verify' },
    { pattern: /Webhook\(/i, method: 'svix_verify' },
  ],
  paddle: [
    { pattern: /p-signature/i, method: 'paddle_signature' },
    { pattern: /verifyPaddle/i, method: 'paddle_signature' },
  ],
  paypal: [
    { pattern: /x-paypal-transmission/i, method: 'paypal_signature' },
    { pattern: /verifyPaypal/i, method: 'paypal_signature' },
  ],
  twilio: [
    { pattern: /x-twilio-signature/i, method: 'generic_hmac' },
    { pattern: /validateRequest/i, method: 'generic_hmac' },
  ],
  sendgrid: [
    { pattern: /x-twilio-email-event-webhook-signature/i, method: 'generic_hmac' },
  ],
  postmark: [
    { pattern: /x-postmark-signature/i, method: 'generic_hmac' },
  ],
  shopify: [
    { pattern: /x-shopify-hmac-sha256/i, method: 'generic_hmac' },
  ],
  plaid: [
    { pattern: /plaid-verification/i, method: 'generic_hmac' },
  ],
  lemonsqueezy: [
    { pattern: /x-signature/i, method: 'generic_hmac' },
  ],
  generic: [
    { pattern: /crypto\.createHmac/i, method: 'generic_hmac' },
    { pattern: /createHmac/i, method: 'generic_hmac' },
    { pattern: /timingSafeEqual/i, method: 'generic_hmac' },
    { pattern: /verifySignature/i, method: 'generic_hmac' },
  ],
};

// Persistence patterns (where processed event IDs are stored)
const PERSISTENCE_PATTERNS = {
  database: [
    /prisma.*create.*processed/i,
    /insert.*processed.*event/i,
    /create.*webhook.*event/i,
    /\.create\s*\(\s*\{[^}]*eventId/i,
    /processedEvents\.create/i,
    /processedWebhookEvent\.create/i,  // db.processedWebhookEvent.create
    /db\..*\.create/i,                 // Generic Prisma create pattern
  ],
  cache: [
    /redis\.set/i,
    /redis\.get/i,     // Reading from redis for dedup check
    /cache\.set/i,
    /cache\.get/i,     // Reading from cache for dedup check
    /setex/i,
    /\.set\s*\([^,]+,.*event/i,
  ],
  // Wrapper functions that handle idempotency internally (call into db/cache)
  wrapperFunctions: [
    /tryProcess.*Webhook/i,           // tryProcessWebhook(eventId, source, type)
    /checkAndMark.*Processed/i,       // checkAndMarkProcessed(id)
    /markAs.*Processed/i,             // markAsProcessed(eventId)
    /isWebhookProcessed/i,            // isWebhookProcessed(id) + markWebhookProcessed
    /processWebhookIdempotent/i,      // processWebhookIdempotently(event)
    /withIdempotency/i,               // withIdempotency(id, handler)
    /ensureIdempotent/i,              // ensureIdempotent(eventId)
    /deduplicateWebhook/i,            // deduplicateWebhook(id)
    /withLock\s*\(/i,                 // withLock(key, handler) - distributed lock
    /acquireLock\s*\(/i,              // acquireLock(key) - explicit lock acquire
    /runWithLock/i,                   // runWithLock(key, handler)
    /lockAndProcess/i,                // lockAndProcess(id, handler)
  ],
};

/**
 * Detect if a file is a webhook MANAGEMENT API (CRUD operations)
 * vs a webhook RECEIVER endpoint.
 *
 * Management APIs create/update/delete webhooks we SEND.
 * Receiver endpoints receive webhooks FROM external services.
 *
 * Only receiver endpoints need signature verification.
 */
function isWebhookManagementFile(codeText: string): boolean {
  // Patterns that indicate webhook management (CRUD) operations
  const managementPatterns = [
    // CRUD operations on webhooks
    /createWebhook\s*[=:]/i,
    /updateWebhook\s*[=:]/i,
    /deleteWebhook\s*[=:]/i,
    /listWebhooks?\s*[=:]/i,
    /getWebhook\s*[=:]/i,
    /findWebhook/i,
    // Database operations on webhook table
    /prisma\.webhook\./i,
    /db\.webhook\./i,
    /webhook\.create\(/i,
    /webhook\.update\(/i,
    /webhook\.delete\(/i,
    /webhook\.findMany/i,
    /webhook\.findUnique/i,
    // Webhook subscription management
    /subscribeWebhook/i,
    /unsubscribeWebhook/i,
    /registerWebhook/i,
    /deregisterWebhook/i,
  ];

  // Patterns that indicate webhook RECEIVING (not management)
  const receiverPatterns = [
    /stripe\.webhooks\.constructEvent/i,
    /verifyWebhookSignature/i,
    /x-hub-signature/i,
    /x-slack-signature/i,
    /svix-id/i,
    /p-signature/i,
    /handleStripeEvent/i,
    /handleWebhookEvent/i,
    /webhookHandler\s*=/i,
    /processWebhookPayload/i,
  ];

  // If it has receiver patterns, it's NOT a management file
  if (receiverPatterns.some((p) => p.test(codeText))) {
    return false;
  }

  // If it has multiple management patterns, it's likely a management API
  const managementMatches = managementPatterns.filter((p) => p.test(codeText));
  return managementMatches.length >= 2;
}

export async function extractWebhooks(options: ExtractorOptions): Promise<WebhookHandler[]> {
  const { targetPath, config } = options;
  const webhooks: WebhookHandler[] = [];

  // Find all source files
  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return webhooks;
  }

  // Extract webhook handlers from each file
  for (const sourceFile of sourceFiles) {
    const fileWebhooks = extractWebhooksFromFile(sourceFile, targetPath);
    webhooks.push(...fileWebhooks);
  }

  return webhooks;
}

function extractWebhooksFromFile(sourceFile: SourceFile, targetPath: string): WebhookHandler[] {
  const webhooks: WebhookHandler[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');
  const fileText = sourceFile.getFullText();

  // First check exclusions - never process these files
  if (NON_WEBHOOK_FILE_PATTERNS.some((p) => p.test(relativePath))) {
    return webhooks;
  }

  // Strip comments for pattern matching to avoid false positives
  const codeOnlyText = stripComments(fileText);

  // Skip webhook MANAGEMENT APIs (2026-01-09 accuracy fix)
  // These are APIs for creating/updating/deleting webhooks, not receiving them
  if (isWebhookManagementFile(codeOnlyText)) {
    return webhooks;
  }

  // Check if this file likely contains webhooks (use code-only text)
  const isWebhookFile =
    WEBHOOK_ROUTE_PATTERNS.some((p) => p.test(relativePath)) ||
    WEBHOOK_ROUTE_PATTERNS.some((p) => p.test(codeOnlyText)) ||
    WEBHOOK_FUNCTION_PATTERNS.some((p) => p.test(codeOnlyText));

  if (!isWebhookFile) {
    return webhooks;
  }

  // Find webhook handler functions
  sourceFile.forEachDescendant((node) => {
    // Check for function declarations that look like webhook handlers
    if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isMethodDeclaration(node)) {
      const name = getFunctionName(node);
      if (name && WEBHOOK_FUNCTION_PATTERNS.some((p) => p.test(name))) {
        // Skip non-handler functions (React components, management functions, etc.)
        if (NON_HANDLER_FUNCTION_PATTERNS.some((p) => p.test(name))) {
          return; // Skip this function
        }

        // Skip helper functions - only include actual handlers
        if (!isWebhookHandler(node, name)) {
          return; // Skip this function, it's a helper
        }

        const handler = analyzeWebhookHandler(node, relativePath);
        if (handler) {
          webhooks.push(handler);
        }
      }
    }

    // Check for route definitions with webhook paths
    if (Node.isCallExpression(node)) {
      const routeWebhook = checkForWebhookRoute(node, relativePath);
      if (routeWebhook) {
        webhooks.push(routeWebhook);
      }
    }
  });

  // NOTE: Removed generic entry creation (2026-01-09 accuracy fix)
  // Previously, we created a webhook handler for ANY file matching webhook patterns,
  // even without an actual handler function. This caused many false positives:
  // - Design system exports (logos, components)
  // - Webhook management APIs (CRUD, not receiving)
  // - Frontend API client code
  //
  // Now we only flag files where we find an actual webhook handler function.
  // If webhooks.length === 0, this file doesn't have a webhook handler to check.

  return webhooks;
}

function getFunctionName(node: Node): string | undefined {
  if (Node.isFunctionDeclaration(node)) {
    return node.getName();
  }
  if (Node.isMethodDeclaration(node)) {
    return node.getName();
  }
  if (Node.isArrowFunction(node)) {
    const parent = node.getParent();
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    if (Node.isPropertyAssignment(parent)) {
      return parent.getName();
    }
  }
  return undefined;
}

function analyzeWebhookHandler(node: Node, file: string): WebhookHandler | null {
  const line = node.getStartLineNumber();
  const functionText = node.getText();
  const handlerName = getFunctionName(node);

  // Strip comments to avoid false positives from TODOs, documentation, etc.
  const codeOnlyText = stripComments(functionText);

  // Detect provider (use code-only text)
  const provider = detectProvider(file, codeOnlyText);

  // Check for idempotency patterns in the function (code only, no comments)
  const hasIdempotencyCheck =
    IDEMPOTENCY_PATTERNS.some((p) => p.test(codeOnlyText)) ||
    EVENT_ID_STORAGE_PATTERNS.some((p) => p.test(codeOnlyText));

  // Extract event types if possible (can use full text, string literals are fine)
  const eventTypes = extractEventTypes(functionText);

  // Find where idempotency key is used (code only)
  const idempotencyKeyLocation = hasIdempotencyCheck ? findIdempotencyLocation(codeOnlyText) : undefined;

  // Detect event ID extraction method (code only)
  const eventIdExtraction = detectEventIdExtraction(provider, codeOnlyText);

  // Detect signature verification (code only)
  const signatureVerification = detectSignatureVerification(provider, codeOnlyText);

  // Detect persistence marker (code only)
  const persistenceMarker = detectPersistenceMarker(codeOnlyText);

  // Detect partial idempotency - which event types are protected
  const eventTypeIdempotency = eventTypes.length > 1
    ? detectEventTypeIdempotency(functionText)
    : undefined;

  return {
    file,
    line,
    provider,
    eventTypes: eventTypes.length > 0 ? eventTypes : undefined,
    hasIdempotencyCheck,
    idempotencyKeyLocation,
    eventIdExtraction,
    signatureVerification,
    persistenceMarker,
    handlerName,
    eventTypeIdempotency,
  };
}

function detectEventIdExtraction(
  provider: WebhookProvider,
  text: string
): WebhookHandler['eventIdExtraction'] {
  // Check provider-specific patterns first
  const providerPatterns = EVENT_ID_EXTRACTION_PATTERNS[provider] ?? [];
  for (const { pattern, method } of providerPatterns) {
    const match = text.match(pattern);
    if (match) {
      return { method, location: match[0] };
    }
  }

  // Check generic patterns if not found
  if (provider !== 'generic') {
    for (const { pattern, method } of EVENT_ID_EXTRACTION_PATTERNS['generic'] ?? []) {
      const match = text.match(pattern);
      if (match) {
        return { method, location: match[0] };
      }
    }
  }

  return { method: 'none' };
}

function detectSignatureVerification(
  provider: WebhookProvider,
  text: string
): WebhookHandler['signatureVerification'] {
  const providerPatterns = SIGNATURE_VERIFICATION_PATTERNS[provider] ?? [];
  for (const { pattern, method } of providerPatterns) {
    const match = text.match(pattern);
    if (match) {
      return { method, location: match[0] };
    }
  }

  if (provider !== 'generic') {
    for (const { pattern, method } of SIGNATURE_VERIFICATION_PATTERNS['generic'] ?? []) {
      const match = text.match(pattern);
      if (match) {
        return { method, location: match[0] };
      }
    }
  }

  return { method: 'none' };
}

function detectPersistenceMarker(text: string): WebhookHandler['persistenceMarker'] {
  // Check for database persistence
  for (const pattern of PERSISTENCE_PATTERNS.database) {
    const match = text.match(pattern);
    if (match) {
      return { type: 'database', location: match[0] };
    }
  }

  // Check for cache persistence
  for (const pattern of PERSISTENCE_PATTERNS.cache) {
    const match = text.match(pattern);
    if (match) {
      return { type: 'cache', location: match[0] };
    }
  }

  // Check for wrapper functions (these handle persistence internally)
  for (const pattern of PERSISTENCE_PATTERNS.wrapperFunctions) {
    const match = text.match(pattern);
    if (match) {
      return { type: 'database', location: match[0] };  // Assume wrapper uses database
    }
  }

  return { type: 'none' };
}

function checkForWebhookRoute(node: CallExpression, file: string): WebhookHandler | null {
  const callText = node.getText();

  // Check for route definitions like app.post('/webhook', ...)
  const routeMatch = callText.match(/\.(post|get|put|all)\s*\(\s*['"`]([^'"`]+)['"`]/);
  if (routeMatch) {
    const path = routeMatch[2];
    if (path && WEBHOOK_ROUTE_PATTERNS.some((p) => p.test(path))) {
      const line = node.getStartLineNumber();
      // Strip comments before checking for idempotency patterns
      const codeOnlyText = stripComments(callText);
      const hasIdempotencyCheck = IDEMPOTENCY_PATTERNS.some((p) => p.test(codeOnlyText));
      const provider = detectProvider(path, codeOnlyText);
      const signatureVerification = detectSignatureVerification(provider, codeOnlyText);

      return {
        file,
        line,
        provider,
        hasIdempotencyCheck,
        signatureVerification,
      };
    }
  }

  return null;
}

function detectProvider(
  context: string,
  text: string
): WebhookProvider {
  const combined = (context + text).toLowerCase();

  // Payment providers
  if (combined.includes('stripe') || combined.includes('constructevent')) {
    return 'stripe';
  }
  if (combined.includes('paddle') || combined.includes('p-signature')) {
    return 'paddle';
  }
  if (combined.includes('lemonsqueezy') || combined.includes('lemon-squeezy') || combined.includes('lemon_squeezy')) {
    return 'lemonsqueezy';
  }
  if (combined.includes('paypal') || combined.includes('x-paypal-transmission')) {
    return 'paypal';
  }

  // Auth providers
  if (combined.includes('clerk') && !combined.includes('postmark')) {
    return 'clerk';
  }

  // Email providers
  if (combined.includes('resend') && !combined.includes('sendgrid')) {
    return 'resend';
  }
  if (combined.includes('sendgrid') || combined.includes('sg_event_id')) {
    return 'sendgrid';
  }
  if (combined.includes('postmark') || combined.includes('x-postmark')) {
    return 'postmark';
  }

  // Communication providers
  if (combined.includes('twilio') || combined.includes('messagesid') || combined.includes('x-twilio-signature')) {
    return 'twilio';
  }
  if (combined.includes('slack') || combined.includes('x-slack-signature')) {
    return 'slack';
  }

  // Dev/code providers
  if (combined.includes('github') || combined.includes('x-hub-signature') || combined.includes('x-github-delivery')) {
    return 'github';
  }

  // E-commerce providers
  if (combined.includes('shopify') || combined.includes('x-shopify-webhook')) {
    return 'shopify';
  }

  // Financial providers
  if (combined.includes('plaid')) {
    return 'plaid';
  }

  // Generic webhook infrastructure
  if (combined.includes('svix') || combined.includes('svix-id')) {
    return 'svix';
  }

  return 'generic';
}

function extractEventTypes(text: string): string[] {
  const types: string[] = [];

  // Look for switch cases on event types
  const switchMatch = text.match(/case\s+['"`]([^'"`]+)['"`]/g);
  if (switchMatch) {
    for (const match of switchMatch) {
      const type = match.match(/['"`]([^'"`]+)['"`]/)?.[1];
      if (type) {
        types.push(type);
      }
    }
  }

  // Look for if statements checking event types
  const ifMatch = text.match(/event\.type\s*===?\s*['"`]([^'"`]+)['"`]/g);
  if (ifMatch) {
    for (const match of ifMatch) {
      const type = match.match(/['"`]([^'"`]+)['"`]/)?.[1];
      if (type) {
        types.push(type);
      }
    }
  }

  return [...new Set(types)];
}

/**
 * Detect partial idempotency - which event types have idempotency protection
 * This identifies cases where some events are protected but others aren't.
 */
function detectEventTypeIdempotency(
  text: string
): Array<{ eventType: string; hasIdempotency: boolean; line?: number }> {
  const results: Array<{ eventType: string; hasIdempotency: boolean; line?: number }> = [];

  // Strip comments first
  const codeText = stripComments(text);

  // Pattern 1: Switch statement with case blocks
  // Look for: case 'event.type': ... break;
  const switchRegex = /case\s+['"`]([^'"`]+)['"`]\s*:\s*([\s\S]*?)(?=case\s+['"`]|default\s*:|$)/gi;
  let match;

  while ((match = switchRegex.exec(codeText)) !== null) {
    const eventType = match[1];
    const caseBlock = match[2] ?? '';

    if (eventType) {
      // Check if this case block has idempotency patterns
      const hasIdempotency = IDEMPOTENCY_PATTERNS.some(p => p.test(caseBlock)) ||
        EVENT_ID_STORAGE_PATTERNS.some(p => p.test(caseBlock));

      // Calculate approximate line number
      const beforeMatch = text.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      results.push({
        eventType,
        hasIdempotency,
        line: lineNumber,
      });
    }
  }

  // Pattern 2: If statements checking event type
  // Look for: if (event.type === 'type') { ... }
  const ifRegex = /if\s*\(\s*event\.type\s*===?\s*['"`]([^'"`]+)['"`]\s*\)\s*\{([\s\S]*?)\}/gi;

  while ((match = ifRegex.exec(codeText)) !== null) {
    const eventType = match[1];
    const ifBlock = match[2] ?? '';

    if (eventType) {
      // Skip if already detected from switch
      if (results.some(r => r.eventType === eventType)) {
        continue;
      }

      const hasIdempotency = IDEMPOTENCY_PATTERNS.some(p => p.test(ifBlock)) ||
        EVENT_ID_STORAGE_PATTERNS.some(p => p.test(ifBlock));

      const beforeMatch = text.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      results.push({
        eventType,
        hasIdempotency,
        line: lineNumber,
      });
    }
  }

  return results;
}

function findIdempotencyLocation(text: string): string | undefined {
  // Try to find where the idempotency check happens
  for (const pattern of IDEMPOTENCY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}
