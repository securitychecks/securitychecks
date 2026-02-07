/**
 * Extractors - Extract artifacts from target codebase
 *
 * Each extractor analyzes the codebase for specific patterns and returns
 * structured data that can be used by checkers to verify invariants.
 */

export { extractServices } from './services.js';
export { extractAuthzCalls } from './authz.js';
export { extractTests } from './tests.js';
export { extractWebhooks } from './webhooks.js';
export { extractTransactions } from './transactions.js';
export { extractCacheOperations, isAuthRelatedCache } from './cache.js';
export { extractMembershipMutations } from './membership.js';
export { extractRoutes } from './routes.js';
export { extractJobs } from './jobs.js';
export { buildCallGraph, findCallersOf, findCalleesOf, hasAuthInCallChain } from './callgraph.js';
export { buildImportGraph, extractImports, extractExports, resolveCall } from './imports.js';
export { extractDataFlows } from './dataflow.js';
export { extractRLS } from './rls.js';

import type { Artifact, ExtractorOptions, SerializableCallGraph } from '../types.js';
import { extractServices } from './services.js';
import { extractAuthzCalls } from './authz.js';
import { extractTests } from './tests.js';
import { extractWebhooks } from './webhooks.js';
import { extractTransactions } from './transactions.js';
import { extractCacheOperations } from './cache.js';
import { extractMembershipMutations } from './membership.js';
import { extractRoutes } from './routes.js';
import { extractJobs } from './jobs.js';
import { buildCallGraph } from './callgraph.js';
import { extractDataFlows } from './dataflow.js';
import { extractRLS } from './rls.js';

const COLLECTOR_DEBUG = process.env['SCHECK_COLLECTOR_DEBUG'] === '1';
const COLLECTOR_SERIAL = process.env['SCHECK_COLLECTOR_SERIAL'] === '1';

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function logCollectorMemory(label: string): void {
  if (!COLLECTOR_DEBUG) return;
  const mem = process.memoryUsage();
  console.log(
    `[collector] mem ${label}: rss=${formatBytes(mem.rss)} heapUsed=${formatBytes(mem.heapUsed)} heapTotal=${formatBytes(mem.heapTotal)} external=${formatBytes(mem.external)}`
  );
}

async function runExtractor<T>(label: string, extractor: () => Promise<T>): Promise<T> {
  if (!COLLECTOR_DEBUG) {
    return extractor();
  }

  const start = Date.now();
  console.log(`[collector] start ${label}`);
  logCollectorMemory(`${label} start`);
  try {
    return await extractor();
  } finally {
    const elapsedSeconds = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[collector] done ${label} (${elapsedSeconds}s)`);
    logCollectorMemory(`${label} done`);
  }
}

/**
 * Extract all artifacts from the target codebase
 */
export async function extractAll(options: ExtractorOptions): Promise<Artifact> {
  let services;
  let authzCalls;
  let tests;
  let webhookHandlers;
  let transactionScopes;
  let cacheOperations;
  let membershipMutations;
  let routes;
  let jobHandlers;
  let dataFlows;
  let callGraphMap;
  let rlsArtifact;

  if (COLLECTOR_SERIAL) {
    services = await runExtractor('services', () => extractServices(options));
    authzCalls = await runExtractor('authz', () => extractAuthzCalls(options));
    tests = await runExtractor('tests', () => extractTests(options));
    webhookHandlers = await runExtractor('webhooks', () => extractWebhooks(options));
    transactionScopes = await runExtractor('transactions', () => extractTransactions(options));
    cacheOperations = await runExtractor('cache', () => extractCacheOperations(options));
    membershipMutations = await runExtractor('membership', () => extractMembershipMutations(options));
    routes = await runExtractor('routes', () => extractRoutes(options));
    jobHandlers = await runExtractor('jobs', () => extractJobs(options));
    dataFlows = await runExtractor('dataflow', () => extractDataFlows(options));
    callGraphMap = await runExtractor('callgraph', () => buildCallGraph(options));
    rlsArtifact = await runExtractor('rls', () => extractRLS(options));
  } else {
    [
      services,
      authzCalls,
      tests,
      webhookHandlers,
      transactionScopes,
      cacheOperations,
      membershipMutations,
      routes,
      jobHandlers,
      dataFlows,
      callGraphMap,
      rlsArtifact,
    ] = await Promise.all([
      runExtractor('services', () => extractServices(options)),
      runExtractor('authz', () => extractAuthzCalls(options)),
      runExtractor('tests', () => extractTests(options)),
      runExtractor('webhooks', () => extractWebhooks(options)),
      runExtractor('transactions', () => extractTransactions(options)),
      runExtractor('cache', () => extractCacheOperations(options)),
      runExtractor('membership', () => extractMembershipMutations(options)),
      runExtractor('routes', () => extractRoutes(options)),
      runExtractor('jobs', () => extractJobs(options)),
      runExtractor('dataflow', () => extractDataFlows(options)),
      runExtractor('callgraph', () => buildCallGraph(options)),
      runExtractor('rls', () => extractRLS(options)),
    ]);
  }

  // Convert Map-based call graph to serializable form
  const callGraph: SerializableCallGraph = {
    nodes: Array.from(callGraphMap.nodes.values()),
  };

  return {
    version: '1.0',
    extractedAt: new Date().toISOString(),
    targetPath: options.targetPath,
    services,
    authzCalls,
    tests,
    cacheOperations,
    transactionScopes,
    webhookHandlers,
    jobHandlers,
    membershipMutations,
    routes,
    dataFlows,
    callGraph,
    rlsArtifact,
  };
}
