/**
 * Waiver Command
 *
 * Manages temporary waivers for findings that need to be fixed later.
 *
 * Usage:
 *   scheck waive FINDING_ID --reason-key will_fix_later --reason "..." --expires 30d
 *   scheck waiver --show         # Show current waivers
 *   scheck waiver --expiring     # Show waivers expiring soon
 *   scheck waiver --prune        # Remove expired waivers
 */

import pc from 'picocolors';
import { resolve } from 'path';
import { audit } from '../audit.js';
import {
  loadWaivers,
  saveWaivers,
  addWaiver,
  pruneExpiredWaivers,
  getExpiringWaivers,
  getWaiverPath,
  WAIVER_REASON_KEYS,
  isValidWaiverReasonKey,
} from '../baseline/index.js';
import { generateFindingId } from '../findings/index.js';

export interface WaiverOptions {
  path?: string;
  show?: boolean;
  expiring?: boolean;
  prune?: boolean;
  expiringDays?: string;
}

export interface WaiveOptions {
  path?: string;
  reason?: string;
  reasonKey?: string;
  expires?: string;
  owner?: string;
}

export async function waiverCommand(options: WaiverOptions): Promise<void> {
  const targetPath = resolve(options.path ?? process.cwd());

  if (options.expiring) {
    await showExpiringWaivers(targetPath, parseInt(options.expiringDays ?? '7', 10));
  } else if (options.prune) {
    await pruneWaivers(targetPath);
  } else {
    // Default: show all waivers
    await showWaivers(targetPath);
  }
}

export async function waiveCommand(findingIdOrInvariant: string, options: WaiveOptions): Promise<void> {
  const targetPath = resolve(options.path ?? process.cwd());

  // Validate required options
  if (!options.reason) {
    console.error(pc.red('Error: --reason is required'));
    console.log(
      pc.dim('Example: scheck waive WEBHOOK.IDEMPOTENT:abc123 --reason-key will_fix_later --reason "Fixing in sprint 42"')
    );
    process.exit(1);
  }

  let reasonKey: import('../baseline/index.js').WaiverReasonKey | undefined;
  if (options.reasonKey) {
    if (!isValidWaiverReasonKey(options.reasonKey)) {
      console.error(pc.red(`Error: Invalid --reason-key "${options.reasonKey}"`));
      console.log(pc.dim(`Valid reason keys: ${WAIVER_REASON_KEYS.join(', ')}`));
      process.exit(1);
    }
    reasonKey = options.reasonKey;
  }

  // Parse expiration
  const expiresInDays = parseExpiration(options.expires ?? '30d');
  if (expiresInDays === null) {
    console.error(pc.red('Error: Invalid --expires format. Use: 7d, 30d, 90d, etc.'));
    process.exit(1);
  }

  // Get owner
  const owner = options.owner ?? process.env['USER'] ?? process.env['USERNAME'] ?? 'unknown';

  // If it's a full findingId (has :hash), find the matching finding
  // Otherwise, run audit and let user pick
  if (findingIdOrInvariant.includes(':')) {
    await waiveByFindingId(targetPath, findingIdOrInvariant, {
      reason: options.reason,
      reasonKey,
      owner,
      expiresInDays,
    });
  } else {
    await waiveByInvariant(targetPath, findingIdOrInvariant, {
      reason: options.reason,
      reasonKey,
      owner,
      expiresInDays,
    });
  }
}

async function showWaivers(targetPath: string): Promise<void> {
  const waivers = await loadWaivers(targetPath);
  const entries = Object.values(waivers.entries);

  if (entries.length === 0) {
    console.log(pc.dim('No active waivers.'));
    return;
  }

  console.log(pc.bold(`Waivers: ${entries.length} active`));
  console.log(pc.dim(`Schema version: ${waivers.schemaVersion}`));
  console.log(pc.dim(`Path: ${getWaiverPath(targetPath)}`));
  console.log();

  // Sort by expiration
  entries.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

  for (const entry of entries) {
    const expiresIn = getExpiresInLabel(entry.expiresAt);
    const isExpiringSoon = new Date(entry.expiresAt) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    console.log(pc.cyan(entry.findingId));
    console.log(`  ${pc.dim('File:')} ${entry.file}${entry.symbol ? `:${entry.symbol}` : ''}`);
    console.log(`  ${pc.dim('Reason:')} ${entry.reason}`);
    if (entry.reasonKey) {
      console.log(`  ${pc.dim('Reason Key:')} ${entry.reasonKey}`);
    }
    console.log(`  ${pc.dim('Owner:')} ${entry.owner}`);
    console.log(`  ${pc.dim('Expires:')} ${isExpiringSoon ? pc.yellow(expiresIn) : expiresIn}`);
    console.log();
  }
}

async function showExpiringWaivers(targetPath: string, withinDays: number): Promise<void> {
  const waivers = await loadWaivers(targetPath);
  const expiring = getExpiringWaivers(waivers, withinDays);

  if (expiring.length === 0) {
    console.log(pc.dim(`No waivers expiring within ${withinDays} days.`));
    return;
  }

  console.log(pc.yellow(`⚠ ${expiring.length} waiver(s) expiring within ${withinDays} days:`));
  console.log();

  for (const entry of expiring) {
    const expiresIn = getExpiresInLabel(entry.expiresAt);
    console.log(pc.yellow(entry.findingId));
    console.log(`  ${pc.dim('File:')} ${entry.file}`);
    console.log(`  ${pc.dim('Owner:')} ${entry.owner}`);
    console.log(`  ${pc.dim('Expires:')} ${expiresIn}`);
    console.log();
  }
}

async function pruneWaivers(targetPath: string): Promise<void> {
  const waivers = await loadWaivers(targetPath);
  const beforeCount = Object.keys(waivers.entries).length;

  const removed = pruneExpiredWaivers(waivers);

  if (removed === 0) {
    console.log(pc.dim('No expired waivers to remove.'));
    return;
  }

  await saveWaivers(targetPath, waivers);

  console.log(pc.green(`✓ Removed ${removed} expired waivers`));
  console.log(`  ${pc.dim(`${beforeCount} → ${Object.keys(waivers.entries).length} waivers`)}`);
}

async function waiveByFindingId(
  targetPath: string,
  findingId: string,
  options: {
    reason: string;
    reasonKey?: import('../baseline/index.js').WaiverReasonKey;
    owner: string;
    expiresInDays: number;
  }
): Promise<void> {
  // Run audit to find the matching finding
  console.log(pc.dim('Finding matching issue...'));

  const result = await audit({ targetPath });
  const findings = result.results.flatMap((r) => r.findings);
  const normalizedId = findingId.split(':').slice(0, 2).join(':');
  const matching = findings.find((f) => generateFindingId(f) === normalizedId);

  if (!matching) {
    console.error(pc.red(`Error: No finding found matching ${findingId}`));
    console.log(pc.dim('Run `scheck run` to see current findings.'));
    process.exit(1);
  }

  const waivers = await loadWaivers(targetPath);
  const entry = addWaiver(waivers, matching, options);
  await saveWaivers(targetPath, waivers);

  console.log(pc.green(`✓ Waiver created`));
  console.log(`  ${pc.dim('Finding:')} ${entry.findingId}`);
  console.log(`  ${pc.dim('Reason:')} ${entry.reason}`);
  if (entry.reasonKey) {
    console.log(`  ${pc.dim('Reason Key:')} ${entry.reasonKey}`);
  }
  console.log(`  ${pc.dim('Expires:')} ${getExpiresInLabel(entry.expiresAt)}`);
}

async function waiveByInvariant(
  targetPath: string,
  invariantId: string,
  options: {
    reason: string;
    reasonKey?: import('../baseline/index.js').WaiverReasonKey;
    owner: string;
    expiresInDays: number;
  }
): Promise<void> {
  // Run audit to find findings for this invariant
  console.log(pc.dim('Finding matching issues...'));

  const result = await audit({ targetPath });
  const findings = result.results.flatMap((r) => r.findings);
  const matching = findings.filter((f) => f.invariantId === invariantId);

  if (matching.length === 0) {
    console.error(pc.red(`Error: No findings found for ${invariantId}`));
    console.log(pc.dim('Run `scheck run` to see current findings.'));
    process.exit(1);
  }

  const waivers = await loadWaivers(targetPath);

  for (const finding of matching) {
    addWaiver(waivers, finding, options);
  }

  await saveWaivers(targetPath, waivers);

  console.log(pc.green(`✓ Created ${matching.length} waiver(s) for ${invariantId}`));
  console.log(`  ${pc.dim('Reason:')} ${options.reason}`);
  if (options.reasonKey) {
    console.log(`  ${pc.dim('Reason Key:')} ${options.reasonKey}`);
  }
  console.log(`  ${pc.dim('Expires:')} in ${options.expiresInDays} days`);
}

// ============================================================================
// Helpers
// ============================================================================

function parseExpiration(value: string): number | null {
  const match = value.match(/^(\d+)d$/i);
  if (!match) return null;
  const days = match[1];
  if (!days) return null;
  return parseInt(days, 10);
}

function getExpiresInLabel(expiresAt: string): string {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffMs = expires.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'expired';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return `in ${diffDays} days`;
}
