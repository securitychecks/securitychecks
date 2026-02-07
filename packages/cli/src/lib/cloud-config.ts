/**
 * Cloud Configuration Management
 *
 * Manages CLI configuration for cloud integration with SecurityChecks.ai
 * Configuration is stored in ~/.securitychecks/config.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Configuration directory path */
const CONFIG_DIR = join(homedir(), '.securitychecks');

/** Configuration file path */
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/** Cloud API base URL */
const DEFAULT_API_URL = 'https://api.securitychecks.ai';

export function normalizeApiBaseUrl(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error('API URL is empty');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid API URL: ${input}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('API URL must start with http:// or https://');
  }

  if (url.username || url.password) {
    throw new Error('API URL must not include credentials');
  }

  url.hash = '';
  url.search = '';

  // Accept both base URLs and v1-style aliases, normalize to a base.
  // Examples:
  // - https://api.securitychecks.ai/v1 -> https://api.securitychecks.ai
  // - https://example.com/api/v1 -> https://example.com
  const pathname = url.pathname.replace(/\/+$/, '');
  const stripped = pathname
    .replace(/\/api\/v1$/i, '')
    .replace(/\/v1$/i, '');
  url.pathname = stripped.length === 0 ? '/' : `${stripped}/`;

  // Remove trailing slash (keep origin+path stable).
  return url.toString().replace(/\/$/, '');
}

/**
 * Cloud configuration structure
 */
export interface CloudConfig {
  /** API key for authentication */
  apiKey?: string;

  /** Default project slug */
  project?: string;

  /** API base URL (for self-hosted instances) */
  apiUrl?: string;

  /** Enable cloud mode by default */
  cloudEnabled?: boolean;

  /** User email (for display purposes) */
  email?: string;

  /** Organization name (for display purposes) */
  organization?: string;

  /** Last sync timestamp */
  lastSync?: string;

  /** Suppress periodic usage awareness banner */
  usageBannerDisabled?: boolean;
}

/**
 * Ensure configuration directory exists
 */
async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load cloud configuration from disk
 */
export async function loadCloudConfig(): Promise<CloudConfig> {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return {};
    }
    const content = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as CloudConfig;
  } catch {
    return {};
  }
}

/**
 * Save cloud configuration to disk
 */
export async function saveCloudConfig(config: CloudConfig): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Update specific configuration values
 */
export async function updateCloudConfig(
  updates: Partial<CloudConfig>
): Promise<CloudConfig> {
  const config = await loadCloudConfig();
  const updated = { ...config, ...updates };
  await saveCloudConfig(updated);
  return updated;
}

/**
 * Clear cloud configuration
 */
export async function clearCloudConfig(): Promise<void> {
  await saveCloudConfig({});
}

/**
 * Get the effective API key (from config, env, or CLI option)
 */
export function getApiKey(cliOption?: string): string | undefined {
  // CLI option takes precedence
  if (cliOption) return cliOption;

  // Then environment variable
  const envKey = process.env['SECURITYCHECKS_API_KEY'];
  if (envKey) return envKey;

  // Config is loaded async, so this needs to be called after loading config
  return undefined;
}

/**
 * Get the effective project slug (from config, env, or CLI option)
 */
export function getProject(cliOption?: string): string | undefined {
  if (cliOption) return cliOption;
  return process.env['SECURITYCHECKS_PROJECT'];
}

/**
 * Get the API base URL
 */
export function getApiUrl(config: CloudConfig): string {
  const raw = config.apiUrl || process.env['SECURITYCHECKS_API_URL'] || DEFAULT_API_URL;
  return normalizeApiBaseUrl(raw);
}

/**
 * Check if cloud mode is enabled
 */
export function isCloudEnabled(
  config: CloudConfig,
  cliOption?: boolean
): boolean {
  if (cliOption !== undefined) return cliOption;
  if (process.env['SECURITYCHECKS_CLOUD'] === 'true') return true;
  return config.cloudEnabled ?? false;
}

/**
 * Format configuration for display
 */
export function formatConfig(config: CloudConfig): string {
  const lines: string[] = [];

  lines.push('Cloud Configuration:');
  lines.push('');

  if (config.apiKey) {
    const masked = config.apiKey.substring(0, 10) + '...' + config.apiKey.slice(-4);
    lines.push(`  API Key:      ${masked}`);
  } else {
    lines.push('  API Key:      (not set)');
  }

  lines.push(`  Project:      ${config.project || '(not set)'}`);
  lines.push(`  API URL:      ${config.apiUrl || DEFAULT_API_URL}`);
  lines.push(`  Cloud Mode:   ${config.cloudEnabled ? 'enabled' : 'disabled'}`);

  if (config.email) {
    lines.push(`  Email:        ${config.email}`);
  }

  if (config.organization) {
    lines.push(`  Organization: ${config.organization}`);
  }

  if (config.lastSync) {
    lines.push(`  Last Sync:    ${config.lastSync}`);
  }

  return lines.join('\n');
}

/**
 * Validate API key format
 */
export function isValidApiKey(key: string): boolean {
  // API keys should start with sc_live_ or sc_test_
  return /^sc_(live|test)_[a-zA-Z0-9]{20,}$/.test(key);
}

export { CONFIG_DIR, CONFIG_FILE, DEFAULT_API_URL };
