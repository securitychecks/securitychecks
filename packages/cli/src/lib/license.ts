/**
 * Cloud Access (Thinware)
 *
 * Local scans always run. Cloud features require an API key.
 */

import { normalizeApiBaseUrl } from './cloud-config.js';

const CLOUD_API_KEY_ENV_VARS = [
  'SECURITYCHECKS_API_KEY',
  'SECURITYCHECKS_LICENSE_KEY',
];

const DEFAULT_CLOUD_BASE_URL = 'https://api.securitychecks.ai';

export function getCloudApiKey(): string | undefined {
  for (const envVar of CLOUD_API_KEY_ENV_VARS) {
    const value = process.env[envVar];
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function formatCloudStatus(apiKey?: string): string {
  if (apiKey) {
    return 'local + cloud (API key detected)';
  }
  return 'local-only (cloud features require SECURITYCHECKS_API_KEY)';
}

export function getCloudApiBaseUrl(): string {
  const raw = process.env['SECURITYCHECKS_API_URL'] ?? DEFAULT_CLOUD_BASE_URL;
  return normalizeApiBaseUrl(raw);
}

export function getCloudEndpoints(baseUrl?: string): {
  patterns: string;
  calibrate: string;
  telemetry: string;
  correlations: string;
  aggregateCalibration: string;
} {
  const base = baseUrl ?? getCloudApiBaseUrl();
  return {
    patterns: `${base}/v1/patterns`,
    calibrate: `${base}/v1/calibrate`,
    telemetry: `${base}/v1/telemetry`,
    correlations: `${base}/v1/correlations`,
    aggregateCalibration: `${base}/v1/calibration`,
  };
}
