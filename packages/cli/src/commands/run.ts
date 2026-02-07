/* eslint-disable max-lines */
/**
 * Run command - run the staff check on the codebase
 */

import pc from 'picocolors';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { collect, loadConfig, resolveTargetPath, DEFAULT_PATTERN_CONFIG } from '@securitychecks/collector';
import type { AuditResult, Finding, CollectorArtifact, Artifact, CalibrationConfig, PatternConfig } from '@securitychecks/collector';
import { ErrorCodes, isCLIError, wrapError, CLIError } from '../lib/errors.js';
import { validateSchemaVersion } from '../lib/schema.js';
import { calibrateFindings, getCalibrationStats } from '../lib/calibration.js';
import {
  fetchPatterns,
  applyPatterns,
  patternMatchesToFindings,
  detectFrameworks,
  getPatternStats,
  loadPatternsFromFile,
  loadBundledPatterns,
  clearPatternCaches,
} from '../lib/patterns.js';
import {
  TEST_PATTERNS,
  shouldUseDevPatterns,
  getTestPatternsForFrameworks,
} from '../lib/test-patterns.js';
import {
  loadBaseline,
  loadWaivers,
  categorizeFindings,
  getCIExitCode,
  getCISummary,
  type CategorizationResult,
} from '../baseline/index.js';
import { generateFindingId } from '../findings/index.js';
import { toSarif } from '../lib/sarif.js';
import {
  correlateFindings,
  formatCorrelatedFinding,
  formatCorrelationStats,
  type CorrelationResult,
} from '../lib/correlation.js';
import { reportCorrelations, type CorrelationTelemetryConfig } from '../lib/correlation-telemetry.js';
import { buildTelemetry, reportTelemetry, isTelemetryDisabled, type TelemetryConfig } from '../lib/telemetry.js';
import {
  fetchAggregateCalibration,
  formatAggregateCalibrationSummary,
  isAggregateCalibrationDisabled,
  type AggregateCalibrationData,
  type AggregateCalibrationConfig,
} from '../lib/calibration.js';
import { getCloudApiKey, getCloudEndpoints, getCloudApiBaseUrl } from '../lib/license.js';
import { FileWatcher } from '../lib/watcher.js';
import { evaluateCloud } from '../lib/cloud-eval.js';

/** Default artifact cache path */
const DEFAULT_ARTIFACT_PATH = '.securitychecks/artifacts.json';

/**
 * Check if a URL points to a local endpoint (localhost or 127.0.0.1).
 * Used to show a warning when using dev/test cloud endpoints.
 */
function isLocalEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    // If URL parsing fails, check simple string match
    const lower = url.toLowerCase();
    return lower.includes('localhost') || lower.includes('127.0.0.1');
  }
}

interface RunOptions {
  path?: string;
  artifact?: string;
  changed?: boolean;
  ci?: boolean;
  only?: string[];
  skip?: string[];
  json?: boolean;
  sarif?: string; // Output path for SARIF file
  quiet?: boolean;
  all?: boolean; // Don't stop early, show everything (including P2)
  includeP2?: boolean; // Include P2 findings (hidden by default)
  // Calibration options
  calibrate?: boolean; // Enable calibration API (default: true from config)
  offline?: boolean; // Disable all API calls (calibration + patterns + cloud eval)
  calibrationEndpoint?: string; // Override calibration API endpoint
  // Pattern options
  patterns?: boolean; // Enable pattern fetching (default: true)
  noPatterns?: boolean; // Disable pattern fetching
  patternEndpoint?: string; // Override pattern API endpoint
  patternsFile?: string; // Load patterns from local file instead of API
  // Watch mode
  watch?: boolean; // Watch for file changes and re-run
  // Usage banner
  noUsageBanner?: boolean; // Suppress periodic usage awareness banner
  // Local scan
  noLocalScan?: boolean; // Skip local source-level pattern scanning
}

/**
 * Load and validate a pre-collected artifact from scc
 */
async function loadArtifact(artifactPath: string): Promise<CollectorArtifact> {
  const fullPath = resolve(artifactPath);

  try {
    const content = await readFile(fullPath, 'utf-8');
    const artifact = JSON.parse(content) as CollectorArtifact;

    // Validate required fields
    if (!artifact.version) {
      throw new CLIError(
        ErrorCodes.ARTIFACT_INVALID,
        `Invalid artifact: missing 'version' field`
      );
    }

    if (artifact.version !== '1.0') {
      throw new CLIError(
        ErrorCodes.ARTIFACT_INVALID,
        `Unsupported artifact version: ${artifact.version} (expected 1.0)`
      );
    }

    if (!artifact.profile) {
      throw new CLIError(
        ErrorCodes.ARTIFACT_INVALID,
        `Invalid artifact: missing 'profile' field`
      );
    }

    if (!artifact.services || !Array.isArray(artifact.services)) {
      throw new CLIError(
        ErrorCodes.ARTIFACT_INVALID,
        `Invalid artifact: missing or invalid 'services' array`
      );
    }

    // Validate schema version compatibility
    const schemaValidation = validateSchemaVersion(artifact.schemaVersion);
    if (!schemaValidation.valid) {
      throw new CLIError(
        ErrorCodes.ARTIFACT_VERSION_MISMATCH,
        schemaValidation.error,
        {
          details: {
            artifactVersion: schemaValidation.artifactVersion,
            currentVersion: schemaValidation.currentVersion,
            remediation: schemaValidation.remediation,
          },
        }
      );
    }

    return artifact;
  } catch (error) {
    if (error instanceof CLIError) throw error;

    if ((error as { code?: string }).code === 'ENOENT') {
      throw new CLIError(
        ErrorCodes.ARTIFACT_NOT_FOUND,
        `Artifact file not found: ${fullPath}`
      );
    }

    throw new CLIError(
      ErrorCodes.ARTIFACT_INVALID,
      `Failed to parse artifact: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Convert CollectorArtifact to Artifact for checker compatibility
 */
function toArtifact(artifact: CollectorArtifact): Artifact {
  return {
    version: '1.0',
    extractedAt: artifact.extractedAt,
    targetPath: artifact.codebase.root,
    services: artifact.services,
    authzCalls: artifact.authzCalls ?? [],
    tests: artifact.tests ?? [],
    cacheOperations: artifact.cacheOperations ?? [],
    transactionScopes: artifact.transactionScopes ?? [],
    webhookHandlers: artifact.webhookHandlers ?? [],
    jobHandlers: artifact.jobHandlers ?? [],
    membershipMutations: artifact.membershipMutations ?? [],
    routes: artifact.routes ?? [],
    callGraph: artifact.callGraph,
    rlsArtifact: artifact.rlsArtifact,
  };
}

function normalizeFrameworkList(frameworks: string[]): string[] {
  return Array.from(new Set(frameworks.map((framework) => framework.toLowerCase())));
}

function getCodebaseFrameworks(artifact: CollectorArtifact): string[] | undefined {
  const codebase = artifact.codebase as { frameworks?: string[] };
  return codebase.frameworks;
}

function resolveFrameworks(artifact: CollectorArtifact, fallback: Artifact): string[] {
  const codebaseFrameworks = getCodebaseFrameworks(artifact);
  if (codebaseFrameworks !== undefined) {
    return normalizeFrameworkList(codebaseFrameworks);
  }
  return detectFrameworks(fallback);
}

/**
 * Resolve calibration config from options and loaded config
 */
function resolveCalibrationConfig(
  options: RunOptions,
  loadedConfig: { calibration?: CalibrationConfig },
  cloudApiKey?: string,
  endpointOverride?: string
): CalibrationConfig | undefined {
  // --offline flag disables calibration entirely
  if (options.offline) {
    return undefined;
  }

  // Start with loaded config (which has defaults)
  const baseConfig = loadedConfig.calibration;
  if (!baseConfig) {
    return undefined;
  }

  const apiKey = cloudApiKey ?? baseConfig.apiKey;
  if (!apiKey) {
    return undefined;
  }

  // Apply CLI overrides
  const config: CalibrationConfig = {
    ...baseConfig,
    // --calibrate flag explicitly enables
    enabled: options.calibrate ?? baseConfig.enabled,
    // --calibration-endpoint overrides
    endpoint: options.calibrationEndpoint ?? endpointOverride ?? baseConfig.endpoint,
    // API key for cloud calibration
    apiKey,
  };

  return config.enabled ? config : undefined;
}

/**
 * Resolve pattern config from options.
 * Returns config for patterns (from file, dev, or API).
 * Returns undefined only if --no-patterns is explicitly set.
 */
function resolvePatternConfig(
  options: RunOptions,
  cloudApiKey?: string,
  endpointOverride?: string
): PatternConfig | undefined {
  // --no-patterns explicitly disables all patterns
  if (options.noPatterns) {
    return undefined;
  }

  // If using local file or dev patterns, always return config (even offline)
  if (options.patternsFile || shouldUseDevPatterns()) {
    return {
      ...DEFAULT_PATTERN_CONFIG,
      enabled: true,
      endpoint: options.patternEndpoint ?? endpointOverride ?? DEFAULT_PATTERN_CONFIG.endpoint,
      apiKey: cloudApiKey,
      // Mark as offline mode since we're not fetching from API
      offlineMode: true,
    };
  }

  // For API-based patterns, need online mode and API key
  if (options.offline || !cloudApiKey) {
    return undefined;
  }

  // Start with defaults
  const config: PatternConfig = {
    ...DEFAULT_PATTERN_CONFIG,
    // --patterns flag explicitly enables (default is true)
    enabled: options.patterns ?? true,
    // --pattern-endpoint overrides
    endpoint: options.patternEndpoint ?? endpointOverride ?? DEFAULT_PATTERN_CONFIG.endpoint,
    // API key for cloud patterns
    apiKey: cloudApiKey,
  };

  return config.enabled ? config : undefined;
}

/**
 * Run checks using a pre-collected artifact
 */
type CloudEndpoints = ReturnType<typeof getCloudEndpoints>;

async function runFromArtifact(
  artifact: CollectorArtifact,
  options: RunOptions
): Promise<{
  result: AuditResult;
  calibrationUsed: boolean;
  patternsUsed: boolean;
  cloudApiKey?: string;
  cloudEndpoints: CloudEndpoints;
  cloudEvalUsed: boolean;
  cloudUsage: { scansUsed: number; scansRemaining: number };
}> {
  const startTime = Date.now();

  // Load config from the artifact's codebase root
  const targetPath = artifact.codebase.root;
  const config = await loadConfig(targetPath);
  const cloudApiKey = getCloudApiKey() ?? config.calibration?.apiKey;
  const cloudBaseUrl = getCloudApiBaseUrl();
  const cloudEndpoints = getCloudEndpoints(cloudBaseUrl);

  // Cloud evaluation is required - no local fallback (IP protection)
  if (!cloudApiKey) {
    throw new CLIError(
      ErrorCodes.AUTH_REQUIRED,
      'API key required for evaluation',
      {
        details: {
          remediation: `Set SECURITYCHECKS_API_KEY environment variable or add apiKey to securitychecks.config.yaml.
Get your API key at https://securitychecks.ai/dashboard/settings/api-keys`,
        },
      }
    );
  }

  if (options.offline) {
    throw new CLIError(
      ErrorCodes.OFFLINE_NOT_SUPPORTED,
      'Offline mode is not supported',
      {
        details: {
          remediation: `SecurityChecks requires cloud evaluation for IP protection.
Remove --offline flag to use cloud evaluation.
For air-gapped environments, contact sales for an enterprise on-premise license.`,
        },
      }
    );
  }

  if (!options.quiet) {
    console.log(pc.dim(`Mode: cloud evaluation (IP protected)`));
    if (isLocalEndpoint(cloudBaseUrl)) {
      console.log(pc.yellow('⚠ Using local cloud endpoint (dev/test)'));
    }
  }

  const auditArtifact = toArtifact(artifact);

  // Cloud evaluation - all pattern checking happens server-side
  if (!options.quiet) {
    console.log(pc.dim(`Evaluating via cloud API...`));
  }

  const cloudEvalResult = await evaluateCloud(artifact, {
    apiKey: cloudApiKey,
    baseUrl: cloudBaseUrl,
    invariants: options.only,
    skip: options.skip,
  });

  let findings: Finding[] = cloudEvalResult.findings;

  if (!options.quiet) {
    console.log(
      pc.dim(
        `Cloud: ${cloudEvalResult.stats.invariantsRun} invariants, ` +
        `${cloudEvalResult.stats.findingsCount} findings in ${cloudEvalResult.stats.executionMs}ms`
      )
    );
    if (cloudEvalResult.usage.scansRemaining !== Infinity) {
      console.log(
        pc.dim(`Usage: ${cloudEvalResult.usage.scansUsed} scans used, ${cloudEvalResult.usage.scansRemaining} remaining`)
      );
    }
  }

  // Track checker results for summary (synthesize from cloud findings)
  interface CheckResult {
    invariantId: string;
    passed: boolean;
    findings: Finding[];
    checkedAt: string;
    duration: number;
  }
  const results: CheckResult[] = [];
  const cloudEvalUsed = true;

  // Synthesize results from findings for compatibility
  const findingsByInvariantMap = new Map<string, Finding[]>();
  for (const finding of findings) {
    const existing = findingsByInvariantMap.get(finding.invariantId) ?? [];
    existing.push(finding);
    findingsByInvariantMap.set(finding.invariantId, existing);
  }

  // Create synthetic results for each invariant with findings
  for (const [invariantId, invariantFindings] of findingsByInvariantMap) {
    results.push({
      invariantId,
      passed: invariantFindings.length === 0,
      findings: invariantFindings,
      checkedAt: new Date().toISOString(),
      duration: cloudEvalResult.stats.executionMs ?? 0,
    });
  }

  // === LOCAL SOURCE-LEVEL PATTERNS ===
  // Cloud eval handles proprietary invariant checks (call graph, artifact-based).
  // Local patterns handle OWASP-type source-level scans (secrets, SQLi, XSS, weak crypto).
  // These are complementary — cloud patterns use artifact metadata, local patterns read source files.
  let patternsUsed = cloudEvalUsed; // Cloud eval includes its own patterns

  if (!options.noLocalScan && options.patterns !== false && !options.noPatterns) {
    // Build artifact for pattern matching (includes routes, webhooks, etc.)
    const artifactForPatterns = {
      version: '1.0' as const,
      extractedAt: artifact.extractedAt,
      targetPath: artifact.codebase.root,
      services: artifact.services,
      authzCalls: artifact.authzCalls ?? [],
      cacheOperations: artifact.cacheOperations ?? [],
      transactionScopes: artifact.transactionScopes ?? [],
      webhookHandlers: artifact.webhookHandlers ?? [],
      jobHandlers: artifact.jobHandlers ?? [],
      membershipMutations: artifact.membershipMutations ?? [],
      tests: artifact.tests ?? [],
      routes: artifact.routes ?? [],
      callGraph: artifact.callGraph,
    };

    const frameworks = resolveFrameworks(artifact, artifactForPatterns);

    if (!options.quiet && frameworks.length > 0) {
      console.log(pc.dim(`Frameworks detected: ${frameworks.join(', ')}`));
    }

    try {
      const localScanStart = Date.now();
      let patterns: typeof TEST_PATTERNS = [];
      let patternSource = 'bundled';

      // Priority: 1. --patterns-file, 2. SECURITYCHECKS_DEV_PATTERNS, 3. Bundled patterns
      // API-fetched patterns are also merged in when available.
      if (options.patternsFile) {
        if (!options.quiet) {
          console.log(pc.dim(`Loading patterns from ${options.patternsFile}...`));
        }
        patterns = await loadPatternsFromFile(options.patternsFile);
        patternSource = 'file';
      } else if (shouldUseDevPatterns()) {
        if (!options.quiet) {
          console.log(pc.yellow('⚠ Using dev test patterns (SECURITYCHECKS_DEV_PATTERNS=1)'));
        }
        patterns = getTestPatternsForFrameworks(frameworks);
        patternSource = 'dev';
      } else {
        // Load bundled source-level patterns (always available, no API needed)
        patterns = loadBundledPatterns(frameworks);
        patternSource = 'bundled';

        // Also try fetching Pro Patterns from API and merge
        const patternConfig = resolvePatternConfig(options, cloudApiKey, cloudEndpoints.patterns);
        if (patternConfig && !patternConfig.offlineMode) {
          try {
            if (!options.quiet) {
              console.log(pc.dim(`Fetching Pro Patterns from ${patternConfig.endpoint}...`));
            }
            const apiPatterns = await fetchPatterns(
              artifactForPatterns,
              patternConfig,
              targetPath,
              frameworks
            );
            if (apiPatterns.length > 0) {
              // Merge API patterns, dedup by id
              const existingIds = new Set(patterns.map(p => p.id));
              for (const ap of apiPatterns) {
                if (!existingIds.has(ap.id)) {
                  patterns.push(ap);
                  existingIds.add(ap.id);
                }
              }
              patternSource = 'bundled+api';
            }
          } catch {
            // API unavailable — bundled patterns still run
          }
        }
      }

      if (patterns.length > 0) {
        patternsUsed = true;

        // Apply patterns to find matches
        const matches = applyPatterns(artifactForPatterns, patterns);

        // Convert matches to findings
        const patternFindings = patternMatchesToFindings(matches, patternSource === 'bundled+api' ? 'local+api' : 'local');

        if (!options.quiet) {
          const stats = getPatternStats(patterns, matches, frameworks);
          const sourceLabel = patternSource === 'bundled' ? '' : ` (${patternSource})`;
          const localScanMs = Date.now() - localScanStart;
          console.log(
            pc.dim(`Local scan: ${stats.patternsLoaded} patterns${sourceLabel}, ${stats.matchesFound} match(es) found in ${localScanMs}ms`)
          );
        }

        // Merge pattern findings with checker findings
        // Avoid duplicates by checking invariantId + file + line
        const existingKeys = new Set(
          findings.map((f) => `${f.invariantId}:${f.evidence[0]?.file}:${f.evidence[0]?.line}`)
        );

        for (const pf of patternFindings) {
          const key = `${pf.invariantId}:${pf.evidence[0]?.file}:${pf.evidence[0]?.line}`;
          if (!existingKeys.has(key)) {
            findings.push(pf);
            existingKeys.add(key);
          }
        }
      } else if (!options.quiet) {
        console.log(pc.dim(`Local scan: No applicable patterns for detected frameworks`));
      }
    } catch {
      // Pattern loading failed - continue with cloud findings only
      if (!options.quiet) {
        console.log(pc.dim(`Local scan: Pattern loading failed, using cloud findings only`));
      }
    } finally {
      // Free memory from file content caches used during pattern matching
      clearPatternCaches();
    }
  }

  // Apply calibration if enabled
  // Skip if cloud evaluation was used (cloud already calibrated)
  // "The SaaS advises. The local tool decides."
  const calibrationConfig = cloudEvalUsed ? undefined : resolveCalibrationConfig(
    options,
    config,
    cloudApiKey,
    cloudEndpoints.calibrate
  );
  let calibrationUsed = cloudEvalUsed; // Cloud eval includes calibration

  if (calibrationConfig) {
    if (!options.quiet) {
      console.log(pc.dim(`Calibrating findings via ${calibrationConfig.endpoint}...`));
    }

    try {
      // Convert CollectorArtifact to the Artifact type expected by calibration
      const artifactForCalibration = {
        version: '1.0' as const,
        extractedAt: artifact.extractedAt,
        targetPath: artifact.codebase.root,
        services: artifact.services,
        authzCalls: artifact.authzCalls ?? [],
        cacheOperations: artifact.cacheOperations ?? [],
        transactionScopes: artifact.transactionScopes ?? [],
        webhookHandlers: artifact.webhookHandlers ?? [],
        jobHandlers: artifact.jobHandlers ?? [],
        membershipMutations: artifact.membershipMutations ?? [],
        tests: artifact.tests ?? [],
        routes: artifact.routes ?? [],
        callGraph: artifact.callGraph,
      };

      findings = await calibrateFindings(
        findings,
        artifactForCalibration,
        calibrationConfig,
        targetPath
      );
      calibrationUsed = true;

      if (!options.quiet) {
        const stats = getCalibrationStats(findings);
        if (stats.calibrated > 0) {
          console.log(
            pc.dim(`Calibration: ${stats.applied}/${stats.calibrated} suggestions applied`)
          );
          for (const change of stats.severityChanges) {
            console.log(pc.dim(`  ${change.from} → ${change.to}: ${change.count} finding(s)`));
          }
        }
      }
    } catch {
      // Calibration failed - continue with local results
      if (!options.quiet) {
        console.log(pc.dim(`Calibration unavailable, using local results`));
      }
    }
  }

  // Update results with calibrated findings
  // (We need to map findings back to their original results)
  const calibratedFindingsByInvariant = new Map<string, Finding[]>();
  for (const finding of findings) {
    const existing = calibratedFindingsByInvariant.get(finding.invariantId) ?? [];
    existing.push(finding);
    calibratedFindingsByInvariant.set(finding.invariantId, existing);
  }

  const updatedResults = results.map((r: CheckResult) => ({
    ...r,
    findings: calibratedFindingsByInvariant.get(r.invariantId) ?? [],
  }));

  const passed = updatedResults.filter((r) => r.passed).length;
  const failed = updatedResults.filter((r) => !r.passed).length;
  const waived = findings.filter((f) => f.waived).length;

  const byPriority = {
    P0: findings.filter((f) => f.severity === 'P0').length,
    P1: findings.filter((f) => f.severity === 'P1').length,
    P2: findings.filter((f) => f.severity === 'P2').length,
  };

  return {
    result: {
      version: '1.0',
      targetPath,
      runAt: new Date().toISOString(),
      duration: Date.now() - startTime,
      summary: { total: updatedResults.length, passed, failed, waived, byPriority },
      results: updatedResults,
      artifact: auditArtifact,
    },
    calibrationUsed,
    patternsUsed,
    cloudApiKey,
    cloudEndpoints,
    cloudEvalUsed,
    cloudUsage: cloudEvalResult.usage,
  };
}

/**
 * Run a single scan (used by both regular and watch mode)
 */
async function runSingleScan(options: RunOptions): Promise<void> {
  const _startTime = Date.now();

  if (!options.quiet) {
    console.log(pc.bold('\n🔍 Scanning for invariants AI misses...\n'));
  }

  try {
    let artifact: CollectorArtifact;

    if (options.artifact) {
      // Use pre-collected artifact
      if (!options.quiet) {
        console.log(pc.dim(`Loading artifact from ${options.artifact}...`));
      }

      artifact = await loadArtifact(options.artifact);
    } else {
      // Collect artifacts first (orchestrate scc collect)
      const targetPath = resolveTargetPath(options.path);

      if (!options.quiet) {
        console.log(pc.dim(`Collecting artifacts from ${targetPath}...`));
      }

      artifact = await collect({
        targetPath,
        profile: 'securitychecks',
      });

      // Cache artifact for inspection/debugging
      const artifactPath = join(targetPath, DEFAULT_ARTIFACT_PATH);
      try {
        await mkdir(dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf-8');
        if (!options.quiet) {
          console.log(pc.dim(`Artifact cached at ${DEFAULT_ARTIFACT_PATH}`));
        }
      } catch {
        // Non-fatal: continue even if we can't cache
      }
    }

    if (!options.quiet) {
      const schemaVer = artifact.schemaVersion ?? '1.0.0';
      console.log(pc.dim(`Artifact: v${artifact.version}, schema=${schemaVer}, profile=${artifact.profile}`));
      console.log(pc.dim(`Codebase: ${artifact.codebase.root}`));
      console.log(pc.dim(`Files: ${artifact.codebase.filesScanned}, Services: ${artifact.services.length}`));
      console.log('');
    }

    const {
      result,
      calibrationUsed: _calibrationUsed,
      patternsUsed: _patternsUsed,
      cloudApiKey,
      cloudEndpoints,
      cloudEvalUsed: _cloudEvalUsed,
      cloudUsage,
    } = await runFromArtifact(artifact, options);

    // Load baseline and waivers
    const targetPath = artifact.codebase.root;
    const [baseline, waivers] = await Promise.all([
      loadBaseline(targetPath),
      loadWaivers(targetPath),
    ]);

    // Categorize findings against baseline/waivers
    const allFindings = result.results.flatMap((r) => r.findings);
    const categorization = categorizeFindings(allFindings, baseline, waivers);

    // Run correlation analysis to detect compounding risks
    const correlationResult = correlateFindings(result.results, result.artifact);
    if (!options.quiet && correlationResult.correlations.length > 0) {
      console.log(pc.dim(`Correlation: ${correlationResult.stats.correlationGroups} compounding risk group(s) detected`));
    }

    // Build artifact for framework detection (used by multiple telemetry calls)
    const artifactForFrameworks = {
      version: '1.0' as const,
      extractedAt: artifact.extractedAt,
      targetPath: artifact.codebase.root,
      services: artifact.services,
      authzCalls: artifact.authzCalls ?? [],
      cacheOperations: artifact.cacheOperations ?? [],
      transactionScopes: artifact.transactionScopes ?? [],
      webhookHandlers: artifact.webhookHandlers ?? [],
      jobHandlers: artifact.jobHandlers ?? [],
      membershipMutations: artifact.membershipMutations ?? [],
      tests: artifact.tests ?? [],
      routes: artifact.routes ?? [],
      callGraph: artifact.callGraph,
    };
    const detectedFrameworks = resolveFrameworks(artifact, artifactForFrameworks);

    // Report correlations to SaaS (non-blocking, for learning)
    if (!options.offline && cloudApiKey && correlationResult.correlations.length > 0) {
      const correlationTelemetryConfig: CorrelationTelemetryConfig = {
        enabled: true,
        apiKey: cloudApiKey,
        endpoint: cloudEndpoints.correlations,
      };

      // Fire-and-forget - don't block on telemetry
      reportCorrelations(correlationResult, correlationTelemetryConfig, detectedFrameworks[0])
        .catch(() => {/* Telemetry failures are silent */});
    }

    // Fetch aggregate calibration data for framework comparison
    let aggregateCalibration: AggregateCalibrationData | null = null;
    if (
      !options.offline &&
      cloudApiKey &&
      !isAggregateCalibrationDisabled() &&
      detectedFrameworks.length > 0
    ) {
      const aggregateConfig: AggregateCalibrationConfig = {
        enabled: true,
        apiKey: cloudApiKey,
        endpoint: cloudEndpoints.aggregateCalibration,
      };

      try {
        const calibrationResult = await fetchAggregateCalibration(detectedFrameworks, aggregateConfig);
        if (calibrationResult.data) {
          aggregateCalibration = calibrationResult.data;
          if (!options.quiet && calibrationResult.data.meta.totalScansAnalyzed > 0) {
            console.log(pc.dim(`Calibration: Loaded baseline from ${calibrationResult.data.meta.totalScansAnalyzed} scans${calibrationResult.fromCache ? ' (cached)' : ''}`));
          }
        }
      } catch {
        // Calibration failures are non-fatal
      }
    }

    // SARIF output for GitHub Code Scanning integration
    if (options.sarif) {
      const cliVersion = process.env['CLI_VERSION'] ?? '0.0.0';
      const sarifOutput = toSarif(result, cliVersion);
      await writeFile(options.sarif, JSON.stringify(sarifOutput, null, 2), 'utf-8');
      if (!options.quiet) {
        console.log(pc.green(`✓ SARIF report written to ${options.sarif}`));
      }
    }

    if (options.json) {
      // Include categorization and correlation in JSON output
      const jsonOutput = {
        ...result,
        categorization: {
          counts: categorization.counts,
          new: categorization.new.map((c) => ({ ...c, findingId: generateFindingId(c) })),
          baselined: categorization.baselined.map((c) => ({ ...c, findingId: generateFindingId(c) })),
          waived: categorization.waived.map((c) => ({
            ...c,
            findingId: generateFindingId(c),
            waiver: c.waiver,
          })),
        },
        correlation: {
          stats: correlationResult.stats,
          groups: correlationResult.correlations.map((c) => ({
            primary: { ...c.primary, findingId: generateFindingId(c.primary) },
            related: c.related.map((r) => ({ ...r, findingId: generateFindingId(r) })),
            sharedContext: c.sharedContext,
            compoundingEffect: c.compoundingEffect,
            adjustedSeverity: c.adjustedSeverity,
            attackPath: c.attackPath,
          })),
        },
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Display results with categorization, correlation, and calibration comparison
    displayResults(result, categorization, correlationResult, options, {
      aggregateCalibration,
      frameworks: detectedFrameworks,
    });

    // Usage awareness banner
    if (!options.quiet && !options.json && !options.ci) {
      const { scansUsed, scansRemaining } = cloudUsage;
      const total = scansUsed + scansRemaining;
      const isSuppressed = options.noUsageBanner
        || process.env['SECURITYCHECKS_NO_USAGE_BANNER'] === '1';

      if (!isSuppressed && scansRemaining !== Infinity && total > 0) {
        const isLow = scansRemaining / total <= 0.2;
        const isNthScan = scansUsed % 5 === 0;

        if (isLow || isNthScan) {
          const color = isLow ? pc.red : pc.yellow;
          const label = isLow ? 'Low quota' : 'Quota';
          console.log(color(`⚠ ${label}: ${scansUsed} of ${total} scans used this month (${scansRemaining} remaining)`));
          console.log(pc.dim('  Upgrade at https://securitychecks.ai/pricing'));
          if (!isLow) {
            console.log(pc.dim('  Suppress with --no-usage-banner or SECURITYCHECKS_NO_USAGE_BANNER=1'));
          }
        }
      }
    }

    // Report anonymous telemetry (non-blocking, opt-out via DO_NOT_TRACK=1)
    if (!options.offline && cloudApiKey && !isTelemetryDisabled()) {
      const telemetryConfig: TelemetryConfig = {
        enabled: true,
        apiKey: cloudApiKey,
        endpoint: cloudEndpoints.telemetry,
      };

      const telemetry = buildTelemetry(result, {
        filesScanned: artifact.codebase.filesScanned,
        frameworks: detectedFrameworks,
        correlation: correlationResult,
        categorization,
        mode: options.ci ? 'ci' : 'manual',
        baselineSize: baseline ? Object.keys(baseline.entries).length : 0,
        waiversCount: waivers ? Object.keys(waivers.entries).length : 0,
      });

      // Fire-and-forget - don't block on telemetry
      reportTelemetry(telemetry, telemetryConfig)
        .catch(() => {/* Telemetry failures are silent */});
    }

    // Exit with appropriate code (CI mode respects baseline/waivers)
    if (options.ci) {
      const exitCode = getCIExitCode(categorization);
      if (exitCode !== 0) {
        console.log(pc.red(`\n${getCISummary(categorization)}`));
        console.log(pc.dim('Use `scheck baseline --update` to baseline known issues.'));
        console.log(pc.dim('Use `scheck waive <findingId>` to temporarily waive issues.\n'));
        process.exit(exitCode);
      } else {
        console.log(pc.green(`\n${getCISummary(categorization)}\n`));
      }
    }
  } catch (error) {
    const cliError = isCLIError(error)
      ? error
      : wrapError(error, ErrorCodes.CHECK_EXECUTION_ERROR, 'Error running scheck');

    if (options.json) {
      console.error(JSON.stringify(cliError.toJSON(), null, 2));
    } else {
      console.error(pc.red(`\n${cliError.toUserString()}\n`));

      // Show remediation guidance
      const remediation = cliError.getRemediation();
      if (remediation) {
        console.error(pc.yellow('How to fix:'));
        for (const line of remediation.split('\n')) {
          console.error(pc.dim(`  ${line}`));
        }
        console.error('');
      }

      if (cliError.cause) {
        console.error(pc.dim(`Caused by: ${cliError.cause.message}`));
        console.error('');
      }

      console.error(pc.dim('Need help? https://securitychecks.ai/docs/troubleshooting'));
      console.error('');
    }
    process.exit(1);
  }
}

/**
 * Check if CLI is enabled via feature flag
 * CLI is in private beta - users should use GitHub App instead
 */
function isCLIEnabled(): boolean {
  const flag = process.env['SECURITYCHECKS_CLI_ENABLED'];
  return flag === '1' || flag === 'true';
}

/**
 * Main run command entry point
 * Handles both single run and watch mode
 */
export async function runCommand(options: RunOptions): Promise<void> {
  // Feature flag: CLI is in private beta
  if (!isCLIEnabled()) {
    console.log(pc.bold('\nSecurityChecks CLI is currently in private beta.\n'));
    console.log('For public access, use our GitHub App instead:');
    console.log(pc.cyan('  https://securitychecks.ai\n'));
    console.log('Benefits of the GitHub App:');
    console.log('  - No installation required');
    console.log('  - Automatic PR checks');
    console.log('  - Evidence directly in your PRs');
    console.log('  - Free tier available\n');
    console.log(pc.dim('Enterprise or beta access? Contact sales@securitychecks.ai'));
    console.log(pc.dim('Set SECURITYCHECKS_CLI_ENABLED=1 if you have approved access.\n'));
    process.exit(0);
  }

  // Watch mode incompatible with certain options
  if (options.watch) {
    if (options.ci) {
      console.error(pc.red('Error: --watch cannot be used with --ci mode'));
      process.exit(1);
    }
    if (options.artifact) {
      console.error(pc.red('Error: --watch cannot be used with --artifact'));
      process.exit(1);
    }
    if (options.json) {
      console.error(pc.red('Error: --watch cannot be used with --json output'));
      process.exit(1);
    }

    const targetPath = resolveTargetPath(options.path);

    console.log(pc.bold('\n👀 Watch mode enabled\n'));
    console.log(pc.dim(`Watching: ${targetPath}`));
    console.log(pc.dim('Press Ctrl+C to stop\n'));

    // Run initial scan
    await runSingleScan(options);

    let runCount = 1;

    // Set up file watcher
    const watcher = new FileWatcher({
      targetPath,
      verbose: !options.quiet,
      onChanged: async () => {
        runCount++;
        // Clear console for cleaner output
        console.clear();
        console.log(pc.bold(`\n👀 Watch mode (run #${runCount})\n`));
        console.log(pc.dim(`Watching: ${targetPath}`));
        console.log(pc.dim('Press Ctrl+C to stop\n'));

        try {
          await runSingleScan(options);
        } catch {
          // Error already displayed by runSingleScan
          console.log(pc.dim('\nWaiting for changes...\n'));
        }
      },
    });

    watcher.on('change', (filename: string) => {
      if (!options.quiet) {
        console.log(pc.dim(`\nFile changed: ${filename}`));
        console.log(pc.dim('Re-running scan...\n'));
      }
    });

    watcher.start();

    // Keep process alive and handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(pc.dim('\n\nStopping watch mode...'));
      watcher.stop();
      process.exit(0);
    });

    // Keep process running
    await new Promise(() => {});
  }

  // Single run mode
  return runSingleScan(options);
}

function displayResults(
  result: AuditResult,
  categorization: CategorizationResult,
  correlation: CorrelationResult,
  options: RunOptions,
  calibration?: {
    aggregateCalibration: AggregateCalibrationData | null;
    frameworks: string[];
  }
): void {
  const { counts } = categorization;
  const showP2 = options.all || options.includeP2;
  const earlyExit = !options.all && !options.ci;

  // Filter findings based on severity visibility
  const visibleFindings = categorization.new.filter(
    (f) => f.severity === 'P0' || f.severity === 'P1' || showP2
  );

  // Count visible findings by severity
  const p0Count = visibleFindings.filter((f) => f.severity === 'P0').length;
  const p1Count = visibleFindings.filter((f) => f.severity === 'P1').length;
  const p2Count = categorization.new.filter((f) => f.severity === 'P2').length;
  const criticalCount = p0Count;
  const totalVisible = p0Count + p1Count + (showP2 ? p2Count : 0);

  if (options.quiet && totalVisible === 0) {
    return;
  }

  // Early exit: stop on first P0 finding
  let stoppedEarly = false;
  let displayFindings = visibleFindings;

  if (earlyExit && p0Count > 0) {
    // Only show first P0 finding
    const firstP0 = visibleFindings.find((f) => f.severity === 'P0');
    if (firstP0) {
      displayFindings = [firstP0];
      stoppedEarly = true;
    }
  }

  // Display findings in new format
  if (displayFindings.length > 0) {
    // Group by invariant
    const byInvariant = new Map<string, typeof displayFindings>();
    for (const finding of displayFindings) {
      const id = finding.invariantId;
      if (!byInvariant.has(id)) {
        byInvariant.set(id, []);
      }
      byInvariant.get(id)!.push(finding);
    }

    for (const [invariantId, findings] of byInvariant) {
      const severity = findings[0]?.severity;
      const severityColor =
        severity === 'P0' ? pc.red : severity === 'P1' ? pc.yellow : pc.blue;

      // [P0] AUTHZ.SERVICE_LAYER.ENFORCED
      console.log(severityColor(`[${severity}] ${invariantId}`));
      console.log('');

      // Staff engineer question
      const staffQuestion = getStaffQuestion(invariantId);
      if (staffQuestion) {
        console.log(`    A staff engineer would ask:`);
        console.log(`    ${pc.cyan(`"${staffQuestion}"`)}`);
        console.log('');
      }

      // Evidence for each finding
      for (const finding of findings) {
        for (const evidence of finding.evidence) {
          console.log(`    → ${pc.white(`${evidence.file}:${evidence.line}`)}`);
          console.log(`      ${pc.dim(finding.message)}`);
        }
      }
      console.log('');
    }
  }

  // Stats line: Scanned X files in Y.Zs
  const duration = (result.duration / 1000).toFixed(1);
  const filesScanned = result.artifact?.services?.length ?? 0;
  console.log(pc.dim(`Scanned ${filesScanned} files in ${duration}s`));
  console.log('');

  // Summary line
  if (stoppedEarly) {
    console.log(pc.red(`✖ Found critical issue. Stopping early.`));
    console.log('');
    console.log(pc.dim(`Run \`scheck run --all\` to see all findings.`));
    console.log(pc.dim(`Run \`scheck explain ${displayFindings[0]?.invariantId}\` for details.`));
  } else if (totalVisible === 0) {
    console.log(pc.green(`✓ No issues found. Ship it.`));
  } else {
    const issueWord = totalVisible === 1 ? 'issue' : 'issues';
    const criticalNote = criticalCount > 0 ? ` (${criticalCount} critical)` : '';
    console.log(pc.red(`✖ ${totalVisible} ${issueWord} require attention${criticalNote}`));
    console.log('');

    // Show explain hint for the first invariant
    const firstInvariant = displayFindings[0]?.invariantId;
    if (firstInvariant) {
      console.log(pc.dim(`Run \`scheck explain ${firstInvariant}\` for details.`));
    }
  }

  // Show hidden P2 count if applicable
  if (!showP2 && p2Count > 0 && !stoppedEarly) {
    console.log(pc.dim(`(${p2Count} P2 finding(s) hidden. Run with --all to see them.)`));
  }

  // Show baselined/waived summary in non-quiet mode
  if (!options.quiet) {
    if (counts.baselined > 0 || counts.waived > 0) {
      console.log('');
      if (counts.baselined > 0) {
        console.log(pc.dim(`Baselined: ${counts.baselined} finding(s) in baseline`));
      }
      if (counts.waived > 0) {
        console.log(pc.dim(`Waived: ${counts.waived} finding(s) temporarily waived`));
      }
    }
  }

  // Correlation warnings (verbose mode only)
  if (correlation.correlations.length > 0 && !options.quiet && options.all) {
    console.log('');
    console.log(pc.bold(pc.magenta('Compounding Risks Detected:')));
    for (const corr of correlation.correlations) {
      console.log(formatCorrelatedFinding(corr));
    }
    console.log(pc.dim(formatCorrelationStats(correlation)));
  }

  // Framework comparison (verbose/all mode only)
  if (calibration?.aggregateCalibration && calibration.frameworks.length > 0 && options.all) {
    const findings = {
      P0: result.summary.byPriority.P0,
      P1: result.summary.byPriority.P1,
      P2: result.summary.byPriority.P2,
      total: counts.total,
    };
    const comparisonSummary = formatAggregateCalibrationSummary(
      calibration.aggregateCalibration,
      calibration.frameworks,
      findings
    );
    if (comparisonSummary) {
      console.log('');
      console.log(pc.bold('Framework Comparison:'));
      for (const line of comparisonSummary.split('\n')) {
        console.log(`  ${pc.dim(line)}`);
      }
    }
  }

  console.log('');
}

/**
 * Returns the "A staff engineer would ask..." question for each invariant.
 * These are the probing questions that senior engineers ask in code review.
 */
function getStaffQuestion(invariantId: string): string | null {
  const questions: Record<string, string> = {
    'AUTHZ.SERVICE_LAYER.ENFORCED':
      'What happens when a background job calls this function directly, bypassing the route?',
    'AUTHZ.MEMBERSHIP.REVOCATION.IMMEDIATE':
      'If I remove someone from a team right now, can they still access team resources?',
    'AUTHZ.KEYS.REVOCATION.IMMEDIATE':
      'If I revoke this API key, does it stop working immediately or is it cached?',
    'WEBHOOK.IDEMPOTENT':
      'What happens when Stripe retries this webhook? Will we double-charge the customer?',
    'WEBHOOK.SIGNATURE.VERIFIED':
      'Are we verifying webhook signatures before processing any side effects?',
    'TRANSACTION.POST_COMMIT.SIDE_EFFECTS':
      'If this transaction rolls back, did we already send an email the user will never receive?',
    'TESTS.NO_FALSE_CONFIDENCE':
      'Is this test actually verifying behavior, or just making CI green?',
    'CACHE.INVALIDATION.ON_AUTH_CHANGE':
      'When someone loses access, how long until the cache catches up?',
    'JOBS.RETRY_SAFE':
      'If this job runs twice, will we have duplicate data or double-bill someone?',
    'BILLING.SERVER_ENFORCED':
      'Can someone bypass the paywall by calling the API directly?',
    'ANALYTICS.SCHEMA.STABLE':
      'If someone adds a field here, will it break our dashboards?',
    'DATAFLOW.UNTRUSTED.SQL_QUERY':
      'Can untrusted input reach a raw SQL/NoSQL query without strict validation?',
    'DATAFLOW.UNTRUSTED.COMMAND_EXEC':
      'Can user input make it into exec/spawn/eval and change what runs?',
    'DATAFLOW.UNTRUSTED.FILE_ACCESS':
      'Can user input control file paths or write locations here?',
    'DATAFLOW.UNTRUSTED.RESPONSE':
      'Can user input drive redirects or HTML output without sanitization?',
    'SECRETS.HARDCODED':
      'If this repo were accidentally made public, what credentials would be exposed?',
    'CRYPTO.ALGORITHM.STRONG':
      'Is this encryption strong enough for the data it protects?',
  };
  return questions[invariantId] ?? null;
}
