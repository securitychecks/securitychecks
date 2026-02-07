/**
 * Membership Mutation Extractor
 *
 * Extracts sites where membership/role/permission is changed.
 * Used to verify that cache is properly invalidated on auth changes
 * (AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE invariant).
 */

import { SourceFile, Node, CallExpression } from 'ts-morph';
import type { MembershipMutation, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

// Function name patterns that indicate membership mutations
const MUTATION_PATTERNS: Array<{
  pattern: RegExp;
  type: MembershipMutation['mutationType'];
  entity: MembershipMutation['entity'];
}> = [
  // Member removal - flexible patterns to match removeTeamMember, removeMember, etc.
  { pattern: /remove.*member/i, type: 'remove', entity: 'member' },
  { pattern: /delete.*member/i, type: 'remove', entity: 'member' },
  { pattern: /kick.*member/i, type: 'remove', entity: 'member' },
  { pattern: /removeFromTeam/i, type: 'remove', entity: 'team' },
  { pattern: /removeFromOrg/i, type: 'remove', entity: 'team' },
  { pattern: /leaveTeam/i, type: 'remove', entity: 'team' },
  { pattern: /leaveOrg/i, type: 'remove', entity: 'team' },

  // Role changes - flexible patterns to match changeUserRole, updateRole, etc.
  { pattern: /update.*role/i, type: 'update', entity: 'role' },
  { pattern: /change.*role/i, type: 'update', entity: 'role' },
  { pattern: /set.*role/i, type: 'update', entity: 'role' },
  { pattern: /demote/i, type: 'downgrade', entity: 'role' },
  { pattern: /downgrade.*role/i, type: 'downgrade', entity: 'role' },
  { pattern: /remove.*role/i, type: 'remove', entity: 'role' },
  { pattern: /revoke.*role/i, type: 'revoke', entity: 'role' },

  // Permission changes
  { pattern: /revokePermission/i, type: 'revoke', entity: 'permission' },
  { pattern: /removePermission/i, type: 'remove', entity: 'permission' },
  { pattern: /updatePermission/i, type: 'update', entity: 'permission' },
  { pattern: /denyAccess/i, type: 'revoke', entity: 'permission' },
  { pattern: /revokeAccess/i, type: 'revoke', entity: 'permission' },

  // API key revocation
  { pattern: /revokeApiKey/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /deleteApiKey/i, type: 'remove', entity: 'apiKey' },
  { pattern: /disableApiKey/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /revokeToken/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /invalidateToken/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /rotateApiKey/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /regenerateApiKey/i, type: 'revoke', entity: 'apiKey' },

  // JWT/Token revocation (new)
  { pattern: /revokeJwt/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /blacklistToken/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /denylistToken/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /addToBlocklist/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /invalidateJwt/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /revokeRefreshToken/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /invalidateRefreshToken/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /incrementTokenVersion/i, type: 'revoke', entity: 'apiKey' },
  { pattern: /bumpTokenVersion/i, type: 'revoke', entity: 'apiKey' },

  // Session invalidation
  { pattern: /invalidateSession/i, type: 'revoke', entity: 'session' },
  { pattern: /revokeSession/i, type: 'revoke', entity: 'session' },
  { pattern: /destroySession/i, type: 'remove', entity: 'session' },
  { pattern: /logout/i, type: 'revoke', entity: 'session' },
  { pattern: /signOut/i, type: 'revoke', entity: 'session' },
  { pattern: /logoutAll/i, type: 'revoke', entity: 'session' },
  { pattern: /signOutAll/i, type: 'revoke', entity: 'session' },
  { pattern: /invalidateAllSessions/i, type: 'revoke', entity: 'session' },
  { pattern: /destroyAllSessions/i, type: 'remove', entity: 'session' },

  // Generic membership patterns
  { pattern: /updateMembership/i, type: 'update', entity: 'member' },
  { pattern: /revokeMembership/i, type: 'revoke', entity: 'member' },
];

// Cache invalidation patterns
const CACHE_INVALIDATION_PATTERNS = [
  /cache\.del/i,
  /cache\.delete/i,
  /cache\.invalidate/i,
  /redis\.del/i,
  /invalidateCache/i,
  /clearCache/i,
  /removeFromCache/i,
  /cacheInvalidate/i,
  /\.del\s*\(/,
  /revalidate/i,
  // JWT blocklist patterns
  /blocklist\.add/i,
  /denylist\.add/i,
  /blacklist\.add/i,
  /revokedTokens\.add/i,
  /revokedTokens\.set/i,
  /tokenBlocklist/i,
  // Token version patterns
  /tokenVersion.*\+\+/i,
  /\.increment.*tokenVersion/i,
  /refreshTokenVersion.*\+\+/i,
  // Session store patterns
  /sessionStore\.destroy/i,
  /sessions\.delete/i,
  /lucia\.invalidate/i,
];

// Cache key patterns that indicate auth-related caching
const AUTH_CACHE_KEY_PATTERNS = [
  /member/i,
  /membership/i,
  /permission/i,
  /role/i,
  /access/i,
  /auth/i,
  /user:\w+/i,
  /session/i,
  /token/i,
  /apiKey/i,
  /team/i,
  /org/i,
];

export async function extractMembershipMutations(
  options: ExtractorOptions
): Promise<MembershipMutation[]> {
  const { targetPath, config } = options;
  const mutations: MembershipMutation[] = [];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return mutations;
  }

  // Extract mutations from each file
  for (const sourceFile of sourceFiles) {
    const fileMutations = extractMutationsFromFile(sourceFile, targetPath);
    mutations.push(...fileMutations);
  }

  return mutations;
}

function extractMutationsFromFile(
  sourceFile: SourceFile,
  targetPath: string
): MembershipMutation[] {
  const mutations: MembershipMutation[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');

  // Find all function declarations that match mutation patterns
  sourceFile.forEachDescendant((node) => {
    // Check function declarations
    if (Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (name) {
        const mutation = checkForMutationPattern(name, node, relativePath);
        if (mutation) {
          mutations.push(mutation);
        }
      }
    }

    // Check arrow functions assigned to variables
    if (Node.isVariableDeclaration(node)) {
      const name = node.getName();
      const initializer = node.getInitializer();
      if (name && initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        const mutation = checkForMutationPattern(name, initializer, relativePath);
        if (mutation) {
          mutations.push(mutation);
        }
      }
    }

    // Check method declarations
    if (Node.isMethodDeclaration(node)) {
      const name = node.getName();
      const mutation = checkForMutationPattern(name, node, relativePath);
      if (mutation) {
        mutations.push(mutation);
      }
    }
  });

  return mutations;
}

function checkForMutationPattern(
  functionName: string,
  node: Node,
  file: string
): MembershipMutation | null {
  // Check if function name matches any mutation pattern
  for (const { pattern, type, entity } of MUTATION_PATTERNS) {
    if (pattern.test(functionName)) {
      const functionBody = node.getText();
      const line = node.getStartLineNumber();

      // Collect signals explaining WHY this was classified
      const signals: string[] = [];

      // Signal: function name match
      signals.push(`name:${functionName}`);
      signals.push(`pattern:${pattern.source}`);

      // Signal: parameters (look for userId, teamId, memberId, etc.)
      const paramSignals = detectParameterSignals(node);
      signals.push(...paramSignals);

      // Signal: database operations
      const dbSignals = detectDatabaseSignals(functionBody);
      signals.push(...dbSignals);

      // Check for cache invalidation in the function body
      const { hasCacheInvalidation, invalidationLocation, relatedCacheKeys, cacheSignals } =
        detectCacheInvalidation(functionBody);
      signals.push(...cacheSignals);

      // Calculate confidence based on signal strength
      const confidence = calculateConfidence(signals, type, entity);

      return {
        file,
        line,
        functionName,
        mutationType: type,
        entity,
        hasCacheInvalidation,
        invalidationLocation,
        relatedCacheKeys: relatedCacheKeys.length > 0 ? relatedCacheKeys : undefined,
        signals,
        confidence,
      };
    }
  }

  return null;
}

/**
 * Detect signals from function parameters
 */
function detectParameterSignals(node: Node): string[] {
  const signals: string[] = [];
  const text = node.getText();

  // Common parameter patterns
  const paramPatterns = [
    { pattern: /userId/i, signal: 'param:userId' },
    { pattern: /teamId/i, signal: 'param:teamId' },
    { pattern: /memberId/i, signal: 'param:memberId' },
    { pattern: /orgId/i, signal: 'param:orgId' },
    { pattern: /roleId/i, signal: 'param:roleId' },
    { pattern: /keyId/i, signal: 'param:keyId' },
    { pattern: /apiKey/i, signal: 'param:apiKey' },
    { pattern: /sessionId/i, signal: 'param:sessionId' },
    { pattern: /tokenId/i, signal: 'param:tokenId' },
  ];

  for (const { pattern, signal } of paramPatterns) {
    if (pattern.test(text)) {
      signals.push(signal);
    }
  }

  return signals;
}

/**
 * Detect signals from database operations
 */
function detectDatabaseSignals(functionBody: string): string[] {
  const signals: string[] = [];
  const code = stripComments(functionBody);

  // Database operation patterns
  const dbPatterns = [
    { pattern: /\.delete\s*\(/i, signal: 'db:delete' },
    { pattern: /\.update\s*\(/i, signal: 'db:update' },
    { pattern: /\.remove\s*\(/i, signal: 'db:remove' },
    { pattern: /teamMember/i, signal: 'db:teamMember' },
    { pattern: /membership/i, signal: 'db:membership' },
    { pattern: /apiKey/i, signal: 'db:apiKey' },
    { pattern: /session/i, signal: 'db:session' },
    { pattern: /role/i, signal: 'db:role' },
  ];

  for (const { pattern, signal } of dbPatterns) {
    if (pattern.test(code)) {
      signals.push(signal);
    }
  }

  return signals;
}

/**
 * Calculate confidence based on signal strength
 * - high: strong name match + relevant params + db operation
 * - medium: name match + some supporting signals
 * - low: name match only
 */
function calculateConfidence(
  signals: string[],
  mutationType: MembershipMutation['mutationType'],
  entity: MembershipMutation['entity']
): 'high' | 'medium' | 'low' {
  const hasParamSignal = signals.some(s => s.startsWith('param:'));
  const hasDbSignal = signals.some(s => s.startsWith('db:'));
  const hasCacheSignal = signals.some(s => s.startsWith('cache:'));

  // Strong indicators for high confidence
  const strongPatterns = ['remove', 'delete', 'revoke', 'downgrade'];
  const isStrongMutationType = strongPatterns.includes(mutationType);

  // High confidence: strong mutation type + params + db operation
  if (isStrongMutationType && hasParamSignal && hasDbSignal) {
    return 'high';
  }

  // High confidence for cache invalidation presence/absence is clear
  if (hasDbSignal && (hasCacheSignal || hasParamSignal)) {
    return 'high';
  }

  // Medium confidence: name match + some supporting signals
  if (hasParamSignal || hasDbSignal) {
    return 'medium';
  }

  // Low confidence: name match only
  return 'low';
}

/**
 * Strip comments from code to avoid false positives
 * (e.g., "// Missing: cache.del(...)" should not match)
 */
function stripComments(code: string): string {
  // Remove single-line comments
  let result = code.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

function detectCacheInvalidation(functionBody: string): {
  hasCacheInvalidation: boolean;
  invalidationLocation?: string;
  relatedCacheKeys: string[];
  cacheSignals: string[];
} {
  let hasCacheInvalidation = false;
  let invalidationLocation: string | undefined;
  const relatedCacheKeys: string[] = [];
  const cacheSignals: string[] = [];

  // Strip comments to avoid false positives from "// Missing: cache.del(...)"
  const codeOnly = stripComments(functionBody);

  // Check for cache invalidation patterns in actual code
  for (const pattern of CACHE_INVALIDATION_PATTERNS) {
    const match = codeOnly.match(pattern);
    if (match) {
      hasCacheInvalidation = true;
      invalidationLocation = match[0];
      cacheSignals.push(`cache:invalidation:${match[0]}`);
      break;
    }
  }

  // Extract cache keys and add as signals
  for (const keyPattern of AUTH_CACHE_KEY_PATTERNS) {
    const matches = codeOnly.match(new RegExp(`['"\`][^'"\`]*${keyPattern.source}[^'"\`]*['"\`]`, 'gi'));
    if (matches) {
      if (hasCacheInvalidation) {
        relatedCacheKeys.push(...matches.slice(0, 3)); // Limit to 3 keys
      }
      // Add signal for the key pattern match
      cacheSignals.push(`cache:key:${keyPattern.source}`);
    }
  }

  if (!hasCacheInvalidation && cacheSignals.length === 0) {
    cacheSignals.push('cache:none');
  }

  return { hasCacheInvalidation, invalidationLocation, relatedCacheKeys, cacheSignals };
}
