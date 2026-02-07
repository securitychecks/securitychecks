/**
 * Transaction Extractor
 *
 * Extracts transaction scopes and detects side effects that occur inside them.
 * This helps identify cases where external effects (emails, webhooks, analytics)
 * might be triggered before the transaction commits.
 */

import { SourceFile, Node, CallExpression } from 'ts-morph';
import type { TransactionScope, SideEffect, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

// Patterns that indicate transaction blocks
const TRANSACTION_PATTERNS = [
  /\$transaction/,           // Prisma
  /\.transaction\(/,         // Generic
  /beginTransaction/,        // TypeORM
  /startTransaction/,        // Generic
  /withTransaction/,         // MongoDB
  /runTransaction/,          // Firebase
  /\.transacting\(/,         // Knex
  /db\.tx\(/,                // pg-promise
  /sequelize\.transaction/,  // Sequelize
];

// Patterns that indicate external side effects
// NOTE: These patterns should be specific enough to avoid matching Prisma model names
// For example, "tx.webhook.deleteMany()" should NOT be flagged as a webhook side effect
const SIDE_EFFECT_PATTERNS: Array<{ pattern: RegExp; type: SideEffect['type'] }> = [
  // Email - specific function names
  { pattern: /send\w*Email/i, type: 'email' },
  { pattern: /send\w*Mail/i, type: 'email' },
  { pattern: /\w+Email\s*\(/i, type: 'email' },
  { pattern: /emailService\./i, type: 'email' },
  { pattern: /mailer\./i, type: 'email' },
  { pattern: /sendgrid\.send/i, type: 'email' },
  { pattern: /resend\.emails?\./i, type: 'email' },
  { pattern: /nodemailer\./i, type: 'email' },
  { pattern: /postmark\.sendEmail/i, type: 'email' },

  // Webhooks - specific patterns for SENDING webhooks (not db.webhook.create)
  // Must match function calls, NOT Prisma model operations
  { pattern: /sendWebhook/i, type: 'webhook' },
  { pattern: /triggerWebhook/i, type: 'webhook' },
  { pattern: /fireWebhook/i, type: 'webhook' },
  { pattern: /dispatchWebhook/i, type: 'webhook' },
  { pattern: /notifyWebhook/i, type: 'webhook' },
  { pattern: /webhookService\.send/i, type: 'webhook' },
  { pattern: /svix\./i, type: 'webhook' },

  // External API calls
  { pattern: /\bfetch\s*\(/i, type: 'external_api' },
  { pattern: /axios\s*[.(]/i, type: 'external_api' },
  { pattern: /httpClient\./i, type: 'external_api' },
  { pattern: /\$\.ajax/i, type: 'external_api' },
  { pattern: /\w+Service\s*\(/i, type: 'external_api' },
  // Skip .post/.get as they're too generic (matches Prisma operations)

  // Analytics
  { pattern: /analytics\.track/i, type: 'analytics' },
  { pattern: /posthog\.capture/i, type: 'analytics' },
  { pattern: /segment\.track/i, type: 'analytics' },
  { pattern: /mixpanel\.track/i, type: 'analytics' },
  { pattern: /amplitude\./i, type: 'analytics' },

  // Queue / Background jobs - specific patterns
  { pattern: /queue\.add/i, type: 'queue' },
  { pattern: /\.enqueue\(/i, type: 'queue' },
  { pattern: /inngest\.send/i, type: 'queue' },
  { pattern: /trigger\.sendEvent/i, type: 'queue' },
  { pattern: /bullmq/i, type: 'queue' },
];

// Patterns that are safe inside transactions (database operations)
// These match ORM method calls like tx.model.create() or db.user.findMany()
const SAFE_PATTERNS = [
  /^[a-z_$][\w$.]*\.create\s*\(/i,   // tx.model.create(, db.model.create(
  /^[a-z_$][\w$.]*\.update\s*\(/i,   // tx.model.update(, db.model.update(
  /^[a-z_$][\w$.]*\.delete\s*\(/i,   // tx.model.delete(
  /^[a-z_$][\w$.]*\.upsert\s*\(/i,   // tx.model.upsert(
  /^[a-z_$][\w$.]*\.findMany\s*\(/i, // tx.model.findMany(
  /^[a-z_$][\w$.]*\.findUnique\s*\(/i,
  /^[a-z_$][\w$.]*\.findFirst\s*\(/i,
  /^[a-z_$][\w$.]*\.count\s*\(/i,
  /^[a-z_$][\w$.]*\.aggregate\s*\(/i,
  /^INSERT\s+INTO/i,           // SQL INSERT (must have INTO)
  /^UPDATE\s+\w+\s+SET/i,      // SQL UPDATE (must have SET)
  /^DELETE\s+FROM/i,           // SQL DELETE (must have FROM)
  /^SELECT\s+/i,               // SQL SELECT
];

// Patterns that indicate this is a Prisma/ORM model operation, NOT an external side effect
// These are higher priority than SIDE_EFFECT_PATTERNS and should be checked first
// Key insight: Prisma operations use tx.model.method() or db.model.method() pattern
const ORM_MODEL_PATTERNS = [
  // Prisma transaction object: tx.model.method()
  /^tx\.[a-z]\w*\./i,              // tx.webhook.deleteMany, tx.user.create
  // Database objects: db.model.method(), prisma.model.method()
  /^db\.[a-z]\w*\./i,              // db.webhook.findMany, db.user.update
  /^prisma\.[a-z]\w*\./i,          // prisma.webhook.create
  // Knex/query builder: table('name').operation
  /^[a-z]\w*\(['"`]\w+['"`]\)\./i, // table('webhook').where
  // Common ORM CRUD method suffixes (more specific)
  /\.createMany\s*\(/i,            // bulk create
  /\.deleteMany\s*\(/i,            // bulk delete - this is the key one for tx.webhook.deleteMany
  /\.updateMany\s*\(/i,            // bulk update
  /\.findFirstOrThrow\s*\(/i,      // find with throw
  /\.findUniqueOrThrow\s*\(/i,     // find unique with throw
  /\.connect\s*\(/i,               // Prisma relation connect
  /\.disconnect\s*\(/i,            // Prisma relation disconnect
  /\.set\s*\(\s*\[/i,              // Prisma relation set with array
];

export async function extractTransactions(options: ExtractorOptions): Promise<TransactionScope[]> {
  const { targetPath, config } = options;
  const transactions: TransactionScope[] = [];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return transactions;
  }

  // Extract transactions from each file
  for (const sourceFile of sourceFiles) {
    const fileTransactions = extractTransactionsFromFile(sourceFile, targetPath);
    transactions.push(...fileTransactions);
  }

  return transactions;
}

function extractTransactionsFromFile(sourceFile: SourceFile, targetPath: string): TransactionScope[] {
  const transactions: TransactionScope[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const callText = node.getText();

    // Check if this is a transaction call
    const isTransaction = TRANSACTION_PATTERNS.some((p) => p.test(callText));
    if (!isTransaction) return;

    // Get the transaction block
    const transactionBlock = findTransactionBlock(node);
    if (!transactionBlock) return;

    const line = node.getStartLineNumber();
    const endLine = transactionBlock.getEndLineNumber();
    const _blockText = transactionBlock.getText(); // Reserved for debugging

    // Find side effects inside the transaction
    const sideEffects = findSideEffectsInBlock(transactionBlock, relativePath);

    // Find function calls inside the transaction (for cross-function tracking)
    const functionCalls = findFunctionCallsInBlock(transactionBlock);

    // Get containing function name
    const functionName = getContainingFunctionName(node);

    transactions.push({
      file: relativePath,
      line,
      endLine,
      functionName,
      containsSideEffects: sideEffects.length > 0,
      sideEffects,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
    });
  });

  return transactions;
}

function findTransactionBlock(node: CallExpression): Node | null {
  // Look for the callback function passed to the transaction
  const args = node.getArguments();

  for (const arg of args) {
    if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
      return arg;
    }
  }

  // Also check for chained .then() or the transaction call itself
  return node;
}

function findSideEffectsInBlock(block: Node, file: string): SideEffect[] {
  const sideEffects: SideEffect[] = [];
  const _blockText = block.getText(); // Reserved for debugging

  block.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const callText = node.getText();

    // Skip if it's a safe database operation
    if (SAFE_PATTERNS.some((p) => p.test(callText))) {
      return;
    }

    // Skip if it's an ORM model operation (higher priority than side effect patterns)
    // This prevents false positives like tx.webhook.deleteMany being flagged as "webhook"
    if (ORM_MODEL_PATTERNS.some((p) => p.test(callText))) {
      return;
    }

    // Check for side effect patterns
    for (const { pattern, type } of SIDE_EFFECT_PATTERNS) {
      if (pattern.test(callText)) {
        sideEffects.push({
          type,
          file,
          line: node.getStartLineNumber(),
          description: extractCallDescription(node),
        });
        break; // Only count each call once
      }
    }
  });

  return sideEffects;
}

function extractCallDescription(node: CallExpression): string {
  const text = node.getText();
  // Truncate long calls
  if (text.length > 100) {
    return text.substring(0, 100) + '...';
  }
  return text;
}

function getContainingFunctionName(node: Node): string | undefined {
  let current = node.getParent();

  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      return current.getName();
    }
    if (Node.isMethodDeclaration(current)) {
      return current.getName();
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
    }

    current = current.getParent();
  }

  return undefined;
}

/**
 * Find function calls made inside a transaction block
 * These are used for cross-function side effect tracking via call graph
 */
function findFunctionCallsInBlock(block: Node): Array<{ name: string; line: number }> {
  const calls: Array<{ name: string; line: number }> = [];
  const seen = new Set<string>();

  // Patterns to skip (database operations, common utilities)
  const skipPatterns = [
    /^await$/,
    /^console\./,
    /^JSON\./,
    /^Object\./,
    /^Array\./,
    /^Promise\./,
    /^tx\./, // Transaction object methods (prisma, etc.)
    /^db\./, // Database operations
    /\.create$/,
    /\.update$/,
    /\.delete$/,
    /\.findFirst$/,
    /\.findUnique$/,
    /\.findMany$/,
    /\.upsert$/,
    /\.count$/,
  ];

  block.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expression = node.getExpression();
    let functionName: string | null = null;

    // Simple function call: myFunction()
    if (Node.isIdentifier(expression)) {
      functionName = expression.getText();
    }
    // Method call: service.method() or this.method()
    else if (Node.isPropertyAccessExpression(expression)) {
      const fullName = expression.getText();
      const methodName = expression.getName();

      // Skip database/utility operations
      const shouldSkip = skipPatterns.some(p => p.test(fullName));
      if (!shouldSkip) {
        // For method calls, include both the method name and the full expression
        // to help with call graph matching
        functionName = methodName;
      }
    }

    if (functionName && !seen.has(functionName)) {
      // Skip common patterns that aren't user-defined functions
      const isBuiltin = skipPatterns.some(p => p.test(functionName!));
      if (!isBuiltin) {
        seen.add(functionName);
        calls.push({
          name: functionName,
          line: node.getStartLineNumber(),
        });
      }
    }
  });

  return calls;
}
