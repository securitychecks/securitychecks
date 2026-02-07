/**
 * Artifact Size Utilities
 *
 * Simple utilities for measuring artifact sizes.
 * Used for metrics and logging.
 *
 * Note: Chunking has been removed. Artifacts are always stored in R2
 * and processed as a single unit by the Fly.io worker.
 */

import type { CollectorArtifact } from './types.js';

/**
 * Get the size of an artifact in bytes
 */
export function getArtifactSize(artifact: CollectorArtifact): number {
  return new TextEncoder().encode(JSON.stringify(artifact)).length;
}

/**
 * Get artifact size in a human-readable format
 */
export function getArtifactSizeFormatted(artifact: CollectorArtifact): string {
  const bytes = getArtifactSize(artifact);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Get artifact stats for logging
 */
export function getArtifactStats(artifact: CollectorArtifact): {
  sizeBytes: number;
  sizeFormatted: string;
  servicesCount: number;
  routesCount: number;
  testsCount: number;
  authzCallsCount: number;
} {
  return {
    sizeBytes: getArtifactSize(artifact),
    sizeFormatted: getArtifactSizeFormatted(artifact),
    servicesCount: artifact.services?.length ?? 0,
    routesCount: artifact.routes?.length ?? 0,
    testsCount: artifact.tests?.length ?? 0,
    authzCallsCount: artifact.authzCalls?.length ?? 0,
  };
}
