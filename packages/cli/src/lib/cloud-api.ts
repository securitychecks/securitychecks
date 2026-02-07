/**
 * Cloud API Client
 *
 * Client for interacting with the SecurityChecks.ai API
 */

import type { Finding } from '@securitychecks/collector';
import { CLIError, ErrorCodes } from './errors.js';
import { normalizeApiBaseUrl } from './cloud-config.js';

/**
 * API response types
 */
export interface ProjectResponse {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  defaultBranch: string;
}

export interface ScanResponse {
  id: string;
  projectId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  branch?: string;
  commitSha?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface FindingSubmitResponse {
  created: number;
  updated: number;
  scanId: string;
}

export interface UserInfoResponse {
  id: string;
  email: string;
  name?: string;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

export interface ValidateKeyResponse {
  valid: boolean;
  email?: string;
  organization?: string;
  plan?: string;
}

/** Default timeout for API requests (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Cloud API client
 */
export class CloudApiClient {
  private apiUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(apiUrl: string, apiKey: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.apiUrl = normalizeApiBaseUrl(apiUrl);
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Make an authenticated API request with timeout
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.apiUrl}/v1${path}`;

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': `scheck-cli/${process.env['CLI_VERSION'] || '0.0.0'}`,
      };
      const bypassSecret = process.env['VERCEL_AUTOMATION_BYPASS_SECRET'];
      if (bypassSecret) {
        headers['x-vercel-protection-bypass'] = bypassSecret;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage: string;

        try {
          const errorJson = JSON.parse(errorBody);
          errorMessage = errorJson.error || errorJson.message || errorBody;
        } catch {
          errorMessage = errorBody || response.statusText;
        }

        if (response.status === 401) {
          throw new CLIError(
            ErrorCodes.CLOUD_AUTH_FAILED,
            'Invalid or expired API key'
          );
        }

        if (response.status === 403) {
          throw new CLIError(
            ErrorCodes.CLOUD_PERMISSION_DENIED,
            `Permission denied: ${errorMessage}`
          );
        }

        if (response.status === 404) {
          throw new CLIError(
            ErrorCodes.CLOUD_NOT_FOUND,
            `Not found: ${errorMessage}`
          );
        }

        if (response.status === 429) {
          throw new CLIError(
            ErrorCodes.CLOUD_RATE_LIMITED,
            'Rate limit exceeded. Please try again later.'
          );
        }

        throw new CLIError(
          ErrorCodes.CLOUD_API_ERROR,
          `API error (${response.status}): ${errorMessage}`
        );
      }

      const text = await response.text();
      if (!text) return {} as T;

      return JSON.parse(text) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof CLIError) throw error;

      // Handle abort/timeout errors
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CLIError(
          ErrorCodes.CLOUD_NETWORK_ERROR,
          `Request timeout: API did not respond within ${this.timeoutMs / 1000} seconds`
        );
      }

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new CLIError(
          ErrorCodes.CLOUD_NETWORK_ERROR,
          `Network error: Unable to connect to ${this.apiUrl}`
        );
      }

      throw new CLIError(
        ErrorCodes.CLOUD_API_ERROR,
        `API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate the API key
   */
  async validateKey(): Promise<ValidateKeyResponse> {
    return this.request<ValidateKeyResponse>('GET', '/keys/validate');
  }

  /**
   * Get project by slug
   */
  async getProject(slug: string): Promise<ProjectResponse> {
    return this.request<ProjectResponse>('GET', `/projects?slug=${encodeURIComponent(slug)}`);
  }

  /**
   * Create a new scan
   */
  async createScan(data: {
    projectSlug: string;
    branch?: string;
    commitSha?: string;
  }): Promise<ScanResponse> {
    return this.request<ScanResponse>('POST', '/scans', data);
  }

  /**
   * Get scan status
   */
  async getScan(id: string): Promise<ScanResponse> {
    return this.request<ScanResponse>('GET', `/scans/${id}`);
  }

  /**
   * Update scan status
   */
  async updateScan(
    id: string,
    data: {
      status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
      summary?: { p0: number; p1: number; p2: number };
      duration?: number;
    }
  ): Promise<ScanResponse> {
    return this.request<ScanResponse>('PATCH', `/scans/${id}`, data);
  }

  /**
   * Submit findings for a scan
   */
  async submitFindings(
    scanId: string,
    findings: Finding[]
  ): Promise<FindingSubmitResponse> {
    const formattedFindings = findings.map((f) => {
      // Get primary evidence location
      const primaryEvidence = f.evidence[0];

      return {
        invariantId: f.invariantId,
        severity: f.severity,
        title: f.message,
        description: f.requiredProof,
        filePath: primaryEvidence?.file,
        lineNumber: primaryEvidence?.line,
        snippet: primaryEvidence?.snippet,
        remediation: f.remediation,
        testSkeleton: f.suggestedTest,
      };
    });

    return this.request<FindingSubmitResponse>('POST', '/findings', {
      scanId,
      findings: formattedFindings,
    });
  }

  /**
   * Get user info
   */
  async getUserInfo(): Promise<UserInfoResponse> {
    return this.request<UserInfoResponse>('GET', '/user');
  }
}

/**
 * Create a cloud API client from configuration
 */
export function createCloudClient(
  apiUrl: string,
  apiKey: string
): CloudApiClient {
  return new CloudApiClient(apiUrl, apiKey);
}
