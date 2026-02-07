/**
 * Baseline and Waiver Storage
 *
 * Handles loading, saving, and managing baseline/waiver files.
 * Files are stored in `.scheck/` directory.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import type { Finding } from '@securitychecks/collector';
import { generateFindingId } from '../findings/finding-id.js';
import {
  BASELINE_SCHEMA_VERSION,
  WAIVER_SCHEMA_VERSION,
  createEmptyBaseline,
  createEmptyWaiverFile,
  getGeneratedBy,
  type BaselineFile,
  type WaiverFile,
  type WaiverEntry,
} from './schema.js';

// Version injected at build time via tsup define
const CLI_VERSION: string = process.env['CLI_VERSION'] ?? '0.0.0-dev';

// ============================================================================
// File Paths
// ============================================================================

const SCHECK_DIR = '.scheck';
const BASELINE_FILE = 'baseline.json';
const WAIVER_FILE = 'waivers.json';

export function getBaselinePath(rootPath: string): string {
  return join(rootPath, SCHECK_DIR, BASELINE_FILE);
}

export function getWaiverPath(rootPath: string): string {
  return join(rootPath, SCHECK_DIR, WAIVER_FILE);
}

// ============================================================================
// Baseline Storage
// ============================================================================

/**
 * Load the baseline file, creating an empty one if it doesn't exist.
 */
export async function loadBaseline(rootPath: string): Promise<BaselineFile> {
  const path = getBaselinePath(rootPath);

  if (!existsSync(path)) {
    return createEmptyBaseline(CLI_VERSION);
  }

  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content) as BaselineFile;

    // Migrate: add missing fields for older files
    if (!data.schemaVersion) {
      data.schemaVersion = BASELINE_SCHEMA_VERSION;
    }
    if (!data.toolVersion) {
      data.toolVersion = CLI_VERSION;
    }
    if (!data.generatedBy) {
      data.generatedBy = getGeneratedBy(CLI_VERSION);
    }

    return data;
  } catch {
    // Corrupted file, return empty baseline
    console.warn(`Warning: Could not parse baseline file at ${path}, using empty baseline`);
    return createEmptyBaseline(CLI_VERSION);
  }
}

/**
 * Save the baseline file with deterministic ordering.
 */
export async function saveBaseline(
  rootPath: string,
  baseline: BaselineFile,
  collectorSchemaVersion?: string
): Promise<void> {
  const path = getBaselinePath(rootPath);

  // Ensure directory exists
  await mkdir(dirname(path), { recursive: true });

  // Update metadata
  baseline.updatedAt = new Date().toISOString();
  baseline.toolVersion = CLI_VERSION;
  baseline.generatedBy = getGeneratedBy(CLI_VERSION);
  if (collectorSchemaVersion) {
    baseline.collectorSchemaVersion = collectorSchemaVersion;
  }

  // Create deterministically ordered output (field order matters for diffs)
  // Using spread with explicit ordering to ensure consistent JSON output
  const orderedBaseline = {
    schemaVersion: baseline.schemaVersion,
    toolVersion: baseline.toolVersion,
    ...(baseline.collectorSchemaVersion ? { collectorSchemaVersion: baseline.collectorSchemaVersion } : {}),
    generatedBy: baseline.generatedBy,
    updatedAt: baseline.updatedAt,
    entries: sortEntriesByFindingId(baseline.entries),
  };

  // Write with 2-space indent and trailing newline
  await writeFile(path, JSON.stringify(orderedBaseline, null, 2) + '\n', 'utf-8');
}

/**
 * Sort entries by findingId for deterministic output.
 */
function sortEntriesByFindingId<T extends { findingId: string }>(
  entries: Record<string, T>
): Record<string, T> {
  const sorted: Record<string, T> = {};
  const keys = Object.keys(entries).sort();
  for (const key of keys) {
    sorted[key] = entries[key] as T;
  }
  return sorted;
}

/**
 * Add findings to the baseline.
 * Returns the number of new entries added.
 */
export function addToBaseline(
  baseline: BaselineFile,
  findings: Finding[],
  notes?: string
): number {
  const now = new Date().toISOString();
  let added = 0;

  for (const finding of findings) {
    const findingId = generateFindingId(finding);

    if (!baseline.entries[findingId]) {
      baseline.entries[findingId] = {
        findingId,
        invariantId: finding.invariantId,
        file: finding.evidence[0]?.file ?? '',
        symbol: finding.evidence[0]?.symbol,
        createdAt: now,
        lastSeenAt: now,
        notes,
      };
      added++;
    } else {
      // Update lastSeenAt for existing entries
      baseline.entries[findingId].lastSeenAt = now;
    }
  }

  return added;
}

/**
 * Check if a finding is in the baseline.
 */
export function isInBaseline(baseline: BaselineFile, finding: Finding): boolean {
  const findingId = generateFindingId(finding);
  return findingId in baseline.entries;
}

/**
 * Remove stale entries that haven't been seen in a certain number of days.
 * Returns the number of entries removed.
 */
export function pruneBaseline(baseline: BaselineFile, staleDays: number = 90): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  const cutoffIso = cutoff.toISOString();

  let removed = 0;
  for (const [id, entry] of Object.entries(baseline.entries)) {
    if (entry.lastSeenAt < cutoffIso) {
      delete baseline.entries[id];
      removed++;
    }
  }

  return removed;
}

// ============================================================================
// Waiver Storage
// ============================================================================

/**
 * Load the waiver file, creating an empty one if it doesn't exist.
 */
export async function loadWaivers(rootPath: string): Promise<WaiverFile> {
  const path = getWaiverPath(rootPath);

  if (!existsSync(path)) {
    return createEmptyWaiverFile(CLI_VERSION);
  }

  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content) as WaiverFile;

    // Migrate: add missing fields for older files
    if (!data.schemaVersion) {
      data.schemaVersion = WAIVER_SCHEMA_VERSION;
    }
    if (!data.toolVersion) {
      data.toolVersion = CLI_VERSION;
    }
    if (!data.generatedBy) {
      data.generatedBy = getGeneratedBy(CLI_VERSION);
    }

    return data;
  } catch {
    console.warn(`Warning: Could not parse waiver file at ${path}, using empty waivers`);
    return createEmptyWaiverFile(CLI_VERSION);
  }
}

/**
 * Save the waiver file with deterministic ordering.
 */
export async function saveWaivers(rootPath: string, waivers: WaiverFile): Promise<void> {
  const path = getWaiverPath(rootPath);

  await mkdir(dirname(path), { recursive: true });

  // Update metadata
  waivers.updatedAt = new Date().toISOString();
  waivers.toolVersion = CLI_VERSION;
  waivers.generatedBy = getGeneratedBy(CLI_VERSION);

  // Create deterministically ordered output (field order matters for diffs)
  const orderedWaivers = {
    schemaVersion: waivers.schemaVersion,
    toolVersion: waivers.toolVersion,
    generatedBy: waivers.generatedBy,
    updatedAt: waivers.updatedAt,
    entries: sortEntriesByFindingId(waivers.entries),
  };

  // Write with 2-space indent and trailing newline
  await writeFile(path, JSON.stringify(orderedWaivers, null, 2) + '\n', 'utf-8');
}

/**
 * Add a waiver for a finding.
 */
export function addWaiver(
  waivers: WaiverFile,
  finding: Finding,
  options: {
    reason: string;
    reasonKey?: WaiverEntry['reasonKey'];
    owner: string;
    expiresInDays: number;
  }
): WaiverEntry {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + options.expiresInDays);

  const findingId = generateFindingId(finding);

  const entry: WaiverEntry = {
    findingId,
    invariantId: finding.invariantId,
    file: finding.evidence[0]?.file ?? '',
    symbol: finding.evidence[0]?.symbol,
    reasonKey: options.reasonKey,
    reason: options.reason,
    owner: options.owner,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  };

  waivers.entries[findingId] = entry;
  return entry;
}

/**
 * Check if a finding has a valid (non-expired) waiver.
 * Returns the waiver if valid, undefined if expired or not found.
 */
export function getValidWaiver(waivers: WaiverFile, finding: Finding): WaiverEntry | undefined {
  const findingId = generateFindingId(finding);
  const waiver = waivers.entries[findingId];

  if (!waiver) {
    return undefined;
  }

  // Check expiration
  const now = new Date();
  const expiresAt = new Date(waiver.expiresAt);

  if (expiresAt < now) {
    // Waiver has expired - behaves as if no waiver exists
    return undefined;
  }

  return waiver;
}

/**
 * Remove expired waivers from the file.
 * Returns the number of waivers removed.
 */
export function pruneExpiredWaivers(waivers: WaiverFile): number {
  const now = new Date().toISOString();
  let removed = 0;

  for (const [id, entry] of Object.entries(waivers.entries)) {
    if (entry.expiresAt < now) {
      delete waivers.entries[id];
      removed++;
    }
  }

  return removed;
}

/**
 * Get all waivers that are about to expire (within N days).
 */
export function getExpiringWaivers(waivers: WaiverFile, withinDays: number = 7): WaiverEntry[] {
  const now = new Date();
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() + withinDays);
  const thresholdIso = threshold.toISOString();

  return Object.values(waivers.entries).filter(
    (entry) => entry.expiresAt > now.toISOString() && entry.expiresAt <= thresholdIso
  );
}
