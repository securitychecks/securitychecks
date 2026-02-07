/* eslint-disable max-lines */
/**
 * Patterns API Client
 *
 * "Patterns add coverage. Calibration adds precision."
 *
 * This module handles fetching Pro Patterns from the SecurityChecks API.
 * Patterns extend the built-in invariant checkers with framework-specific detection.
 *
 * Key principles:
 * - Patterns are cached locally (24h TTL by default)
 * - ETag-based conditional fetching for efficiency
 * - Fails safely to offline mode (no patterns, just built-in checkers)
 * - Patterns are filtered by detected frameworks
 */

import type {
  PatternConfig,
  PatternCache,
  PatternDefinition,
  Artifact,
  Severity,
  Finding,
} from '@securitychecks/collector';
import { DEFAULT_PATTERN_CONFIG } from '@securitychecks/collector';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { globSync } from 'glob';
import { Project, Node } from 'ts-morph';
import { join, dirname, relative } from 'path';

// CLI version for API requests
const CLI_VERSION = '0.1.0';

// Default cache path (relative to project root)
const DEFAULT_CACHE_PATH = '.securitychecks/patterns-cache.json';

// ============================================================================
// API Response Types (matches the API endpoint)
// ============================================================================

interface PatternAPIResponse {
  patterns: APIPattern[];
  meta: {
    total: number;
    fromDatabase: number;
    builtIn: number;
    etag: string;
    maxAge: number;
  };
}

interface APIPattern {
  id: string;
  patternId: string;
  version: string;
  name: string;
  description: string;
  invariantId: string;
  applicability: {
    frameworks: string[];
    frameworkVersions?: string;
    filePatterns: string[];
  };
  detection: unknown;
  finding: {
    severity: Severity;
    message: string;
    requiredProof: string;
    suggestedTest?: string;
  };
  metadata: {
    author: string;
    references: string[];
    tags: string[];
  };
}

// ============================================================================
// Framework Detection
// ============================================================================

/**
 * Detect frameworks from a collector artifact.
 */
export function detectFrameworks(artifact: Artifact): string[] {
  const codebaseFrameworks = (artifact as Artifact & { codebase?: { frameworks?: string[] } })
    .codebase?.frameworks;
  if (codebaseFrameworks !== undefined) {
    return normalizeFrameworkList(codebaseFrameworks);
  }

  const frameworks = new Set<string>();

  // Check routes for framework hints
  if (artifact.routes) {
    for (const route of artifact.routes) {
      if (route.framework && route.framework !== 'unknown') {
        frameworks.add(route.framework.toLowerCase());
      }
    }
  }

  // Check services for framework indicators
  if (artifact.services) {
    for (const service of artifact.services) {
      // Check for Next.js patterns
      if (
        service.file.includes('/app/') &&
        (service.file.endsWith('route.ts') ||
          service.file.endsWith('route.js') ||
          service.file.includes('/actions/'))
      ) {
        frameworks.add('nextjs');
      }

    }
  }

  // Check webhooks for providers
  if (artifact.webhookHandlers) {
    for (const wh of artifact.webhookHandlers) {
      if (wh.provider) {
        // Add provider as a "framework" for pattern matching
        frameworks.add(wh.provider.toLowerCase());
      }
    }
  }

  return Array.from(frameworks);
}

function normalizeFrameworkList(frameworks: string[]): string[] {
  return Array.from(new Set(frameworks.map((framework) => framework.toLowerCase())));
}

// ============================================================================
// Local Code Introspection (sync, cached)
// ============================================================================

const fileDirectiveCache = new Map<string, Set<string>>();
const fileContentCache = new Map<string, { content: string; lines: string[] }>();
const functionRangeCache = new Map<string, FunctionRange[]>();
const packageJsonCache = new Map<string, Set<string>>();
const matcherCache = new Map<string, (text: string) => boolean>();
let tsProject: Project | null = null;

interface FunctionRange {
  name?: string;
  startLine: number;
  endLine: number;
}

function getDirectivePrologue(filePath: string): Set<string> {
  const cached = fileDirectiveCache.get(filePath);
  if (cached) return cached;

  const directives = new Set<string>();
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const line of lines.slice(0, 50)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('//')) continue;
      if (trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      const match = trimmed.match(/^['"]([^'"]+)['"]\s*;?\s*$/);
      if (!match) break;

      const directive = match[1];
      if (!directive) break;
      directives.add(directive);
    }
  } catch {
    // Ignore file read errors; treat as no directives.
  }

  fileDirectiveCache.set(filePath, directives);
  return directives;
}

// ============================================================================
// Code Pattern Matching Utilities
// ============================================================================

type CodePattern = NonNullable<NonNullable<PatternDefinition['detection']>['codePatterns']>[number];

const DEFAULT_GLOB_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.cache/**',
];

const DEFAULT_SOURCE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs}'];

function getProject(): Project {
  if (!tsProject) {
    tsProject = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
    });
  }
  return tsProject;
}

function getFileContent(filePath: string): { content: string; lines: string[] } {
  const cached = fileContentCache.get(filePath);
  if (cached) return cached;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const payload = { content, lines };
    fileContentCache.set(filePath, payload);
    return payload;
  } catch {
    const payload = { content: '', lines: [] };
    fileContentCache.set(filePath, payload);
    return payload;
  }
}

function getFunctionRanges(filePath: string): FunctionRange[] {
  const cached = functionRangeCache.get(filePath);
  if (cached) return cached;

  let sourceFile;
  try {
    const project = getProject();
    sourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
  } catch {
    functionRangeCache.set(filePath, []);
    return [];
  }

  const ranges: FunctionRange[] = [];
  sourceFile.forEachDescendant((node) => {
    if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
      const name = node.getName();
      if (name) {
        ranges.push({
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber(),
        });
      }
      return;
    }

    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const parent = node.getParent();
      let name: string | undefined;
      if (Node.isVariableDeclaration(parent)) {
        name = parent.getName();
      } else if (Node.isPropertyAssignment(parent)) {
        name = parent.getName();
      }

      if (name) {
        ranges.push({
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber(),
        });
      }
    }
  });

  functionRangeCache.set(filePath, ranges);
  return ranges;
}

function findFunctionForLine(line: number, ranges: FunctionRange[]): FunctionRange | undefined {
  let best: FunctionRange | undefined;
  for (const range of ranges) {
    if (line < range.startLine || line > range.endLine) continue;
    if (!best) {
      best = range;
      continue;
    }
    const bestSize = best.endLine - best.startLine;
    const currentSize = range.endLine - range.startLine;
    if (currentSize < bestSize) {
      best = range;
    }
  }
  return best;
}

function parseRegexLiteral(pattern: string): RegExp | null {
  const match = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (!match) return null;
  const source = match[1];
  if (!source) return null;
  const rawFlags = match[2] ?? '';
  const flags = rawFlags.replace('g', '');
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function getMatcher(pattern: string): (text: string) => boolean {
  const cached = matcherCache.get(pattern);
  if (cached) return cached;

  const regex = parseRegexLiteral(pattern);
  const matcher = regex
    ? (text: string) => {
        regex.lastIndex = 0;
        return regex.test(text);
      }
    : (text: string) => text.includes(pattern);

  matcherCache.set(pattern, matcher);
  return matcher;
}

function normalizePatternList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter((v) => v.length > 0) : [value];
}

function matchesAll(patterns: string[], text: string): boolean {
  return patterns.every((pattern) => getMatcher(pattern)(text));
}

function matchesAny(patterns: string[], text: string): boolean {
  return patterns.some((pattern) => getMatcher(pattern)(text));
}

function matchesNone(patterns: string[], text: string): boolean {
  return patterns.every((pattern) => !getMatcher(pattern)(text));
}

function meetsNearbyRequirement(
  lines: string[],
  lineIndex: number,
  requirement: NonNullable<CodePattern['requiresNearby']>
): boolean {
  const start = Math.max(0, lineIndex - requirement.within);
  const end = Math.min(lines.length - 1, lineIndex + requirement.within);
  const windowLines = lines.slice(start, end + 1);

  const any = normalizePatternList(requirement.any);
  const all = normalizePatternList(requirement.all);
  const not = normalizePatternList(requirement.not);

  if (any.length > 0 && !windowLines.some((line) => matchesAny(any, line))) {
    return false;
  }

  if (all.length > 0 && !all.every((pattern) => windowLines.some((line) => getMatcher(pattern)(line)))) {
    return false;
  }

  if (not.length > 0 && windowLines.some((line) => matchesAny(not, line))) {
    return false;
  }

  return true;
}

function collectArtifactFiles(artifact: Artifact): string[] {
  const files = new Set<string>();

  for (const service of artifact.services ?? []) files.add(service.file);
  for (const route of artifact.routes ?? []) files.add(route.file);
  for (const webhook of artifact.webhookHandlers ?? []) files.add(webhook.file);
  for (const tx of artifact.transactionScopes ?? []) files.add(tx.file);
  for (const job of artifact.jobHandlers ?? []) files.add(job.file);
  for (const mutation of artifact.membershipMutations ?? []) files.add(mutation.file);
  for (const test of artifact.tests ?? []) files.add(test.file);
  for (const authzCall of artifact.authzCalls ?? []) files.add(authzCall.file);
  for (const cacheOp of artifact.cacheOperations ?? []) files.add(cacheOp.file);

  return [...files];
}

function collectFilesFromGlobs(targetPath: string, patterns: string[]): Set<string> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern) continue;
    const matches = globSync(pattern, {
      cwd: targetPath,
      absolute: true,
      nodir: true,
      ignore: DEFAULT_GLOB_IGNORE,
    });
    for (const match of matches) {
      files.add(match);
    }
  }
  return files;
}

function intersectFiles(primary: Set<string>, secondary: Set<string>): Set<string> {
  if (primary.size === 0) return new Set(secondary);
  if (secondary.size === 0) return new Set(primary);
  const intersection = new Set<string>();
  for (const file of primary) {
    if (secondary.has(file)) intersection.add(file);
  }
  return intersection;
}

function resolveBaseCandidateFiles(artifact: Artifact, pattern: PatternDefinition): Set<string> {
  const filePatterns = pattern.applicability.filePatterns ?? [];
  if (filePatterns.length > 0) {
    return collectFilesFromGlobs(artifact.targetPath, filePatterns);
  }

  const artifactFiles = collectArtifactFiles(artifact)
    .map((file) => join(artifact.targetPath, file))
    .filter((file) => existsSync(file));

  if (artifactFiles.length > 0) {
    return new Set(artifactFiles);
  }

  return collectFilesFromGlobs(artifact.targetPath, DEFAULT_SOURCE_GLOBS);
}

function findNearestPackageJson(filePath: string, rootPath: string): string | null {
  let current = dirname(filePath);
  const root = rootPath;

  while (true) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) return candidate;

    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function getDependenciesFromPackageJson(packageJsonPath: string): Set<string> {
  const cached = packageJsonCache.get(packageJsonPath);
  if (cached) return cached;

  try {
    const raw = readFileSync(packageJsonPath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, Record<string, string> | undefined>;
    const deps = new Set<string>([
      ...Object.keys(data['dependencies'] ?? {}),
      ...Object.keys(data['devDependencies'] ?? {}),
      ...Object.keys(data['peerDependencies'] ?? {}),
      ...Object.keys(data['optionalDependencies'] ?? {}),
    ]);
    packageJsonCache.set(packageJsonPath, deps);
    return deps;
  } catch {
    const deps = new Set<string>();
    packageJsonCache.set(packageJsonPath, deps);
    return deps;
  }
}

function collectDependenciesForFiles(files: string[], targetPath: string): Set<string> {
  const deps = new Set<string>();
  for (const file of files) {
    const pkg = findNearestPackageJson(file, targetPath);
    if (!pkg) continue;
    const pkgDeps = getDependenciesFromPackageJson(pkg);
    for (const dep of pkgDeps) deps.add(dep);
  }

  if (deps.size === 0) {
    const rootPackage = join(targetPath, 'package.json');
    if (existsSync(rootPackage)) {
      const rootDeps = getDependenciesFromPackageJson(rootPackage);
      for (const dep of rootDeps) deps.add(dep);
    }
  }

  return deps;
}

function hasRequiredDependencies(
  pattern: PatternDefinition,
  files: string[],
  targetPath: string
): boolean {
  const required = pattern.applicability.requiredDependencies ?? [];
  if (required.length === 0) return true;

  const deps = collectDependenciesForFiles(files, targetPath);
  return required.every((dep) => deps.has(dep));
}

function hasExcludedPattern(pattern: PatternDefinition, files: string[]): boolean {
  const excludePatterns = pattern.applicability.excludePatterns ?? [];
  if (excludePatterns.length === 0) return false;

  for (const file of files) {
    const { content } = getFileContent(file);
    if (!content) continue;
    for (const excludePattern of excludePatterns) {
      if (getMatcher(excludePattern)(content)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Load pattern cache from disk.
 */
async function loadCache(cachePath: string): Promise<PatternCache | null> {
  try {
    if (existsSync(cachePath)) {
      const content = await readFile(cachePath, 'utf-8');
      const cache = JSON.parse(content) as PatternCache;

      // Check if cache is expired
      const expiresAt = new Date(cache.expiresAt).getTime();
      if (Date.now() < expiresAt) {
        return cache;
      }
    }
  } catch {
    // Cache corrupted or unreadable
  }
  return null;
}

/**
 * Save pattern cache to disk.
 */
async function saveCache(cachePath: string, cache: PatternCache): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache, null, 2));
  } catch {
    // Failed to save cache, not critical
  }
}

// ============================================================================
// API Client
// ============================================================================

/**
 * Fetch patterns from the API.
 */
async function fetchFromAPI(
  config: PatternConfig,
  frameworks: string[],
  invariants?: string[],
  etag?: string
): Promise<{ patterns: PatternDefinition[]; meta: PatternAPIResponse['meta'] } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    // Build query string
    const params = new URLSearchParams();
    if (frameworks.length > 0) {
      params.set('frameworks', frameworks.join(','));
    }
    if (invariants && invariants.length > 0) {
      params.set('invariants', invariants.join(','));
    }
    params.set('version', CLI_VERSION);

    const url = `${config.endpoint}?${params.toString()}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Version': CLI_VERSION,
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 304 Not Modified - use cached version
    if (response.status === 304) {
      return null;
    }

    if (!response.ok) {
      // API error - fail safe to offline mode
      return null;
    }

    const data = (await response.json()) as PatternAPIResponse;

    // Convert API patterns to PatternDefinition format
    const patterns: PatternDefinition[] = data.patterns.map(convertAPIPattern);

    return { patterns, meta: data.meta };
  } catch {
    // Network error, timeout, etc.
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Convert API pattern format to PatternDefinition.
 */
function convertAPIPattern(apiPattern: APIPattern): PatternDefinition {
  return {
    id: apiPattern.patternId,
    version: apiPattern.version,
    invariantId: apiPattern.invariantId,
    name: apiPattern.name,
    description: apiPattern.description,
    applicability: {
      frameworks: apiPattern.applicability.frameworks,
      frameworkVersions: apiPattern.applicability.frameworkVersions,
      filePatterns: apiPattern.applicability.filePatterns,
    },
    detection: apiPattern.detection as PatternDefinition['detection'],
    finding: {
      severity: apiPattern.finding.severity,
      message: apiPattern.finding.message,
      requiredProof: apiPattern.finding.requiredProof,
      suggestedTest: apiPattern.finding.suggestedTest,
      references: apiPattern.metadata.references,
      tags: apiPattern.metadata.tags,
    },
    metadata: {
      author: apiPattern.metadata.author,
      created: new Date().toISOString(), // API doesn't provide this yet
      references: apiPattern.metadata.references,
    },
  };
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Fetch patterns for a codebase.
 *
 * This is the main entry point for pattern fetching.
 */
export async function fetchPatterns(
  artifact: Artifact,
  config: PatternConfig = DEFAULT_PATTERN_CONFIG,
  targetPath: string = process.cwd(),
  frameworksOverride?: string[]
): Promise<PatternDefinition[]> {
  if (!config.enabled || config.offlineMode) {
    return [];
  }

  const frameworks =
    frameworksOverride !== undefined
      ? normalizeFrameworkList(frameworksOverride)
      : detectFrameworks(artifact);
  if (frameworks.length === 0) {
    // No frameworks detected, no patterns to fetch
    return [];
  }

  const cachePath = config.cache?.path ?? join(targetPath, DEFAULT_CACHE_PATH);

  // Try to load from cache first
  if (config.cache?.enabled) {
    const cache = await loadCache(cachePath);
    if (cache) {
      // Check if cache covers our frameworks
      const cachedFrameworks = new Set<string>();
      for (const pattern of cache.patterns) {
        for (const f of pattern.applicability.frameworks) {
          cachedFrameworks.add(f);
        }
      }

      const allCovered = frameworks.every((f) => cachedFrameworks.has(f));
      if (allCovered) {
        // Try conditional fetch with ETag
        const result = await fetchFromAPI(config, frameworks, undefined, cache.etag);
        if (result === null) {
          // 304 Not Modified - use cached patterns
          return filterPatternsForFrameworks(cache.patterns, frameworks);
        }

        // New patterns - update cache
        const newCache: PatternCache = {
          patterns: result.patterns,
          fetchedAt: new Date().toISOString(),
          etag: result.meta.etag,
          expiresAt: new Date(Date.now() + result.meta.maxAge * 1000).toISOString(),
          apiVersion: '1.0',
        };
        await saveCache(cachePath, newCache);
        return filterPatternsForFrameworks(result.patterns, frameworks);
      }
    }
  }

  // Fetch from API
  const result = await fetchFromAPI(config, frameworks);
  if (result === null) {
    // API failed - return empty (graceful degradation)
    return [];
  }

  // Save to cache
  if (config.cache?.enabled) {
    const cache: PatternCache = {
      patterns: result.patterns,
      fetchedAt: new Date().toISOString(),
      etag: result.meta.etag,
      expiresAt: new Date(Date.now() + result.meta.maxAge * 1000).toISOString(),
      apiVersion: '1.0',
    };
    await saveCache(cachePath, cache);
  }

  return filterPatternsForFrameworks(result.patterns, frameworks);
}

/**
 * Filter patterns to only those applicable to the detected frameworks.
 */
function filterPatternsForFrameworks(
  patterns: PatternDefinition[],
  frameworks: string[]
): PatternDefinition[] {
  return patterns.filter((pattern) =>
    pattern.applicability.frameworks.some((f) => frameworks.includes(f.toLowerCase()))
  );
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Result of matching a pattern against artifact.
 */
export interface PatternMatch {
  pattern: PatternDefinition;
  file: string;
  line: number;
  symbol?: string;
  evidence: string[];
}

/**
 * Apply patterns to an artifact and generate findings.
 *
 * This matches patterns against the artifact data and creates findings
 * for any matches.
 */
export function applyPatterns(
  artifact: Artifact,
  patterns: PatternDefinition[],
  options?: { changedFiles?: Set<string> }
): PatternMatch[] {
  const matches: PatternMatch[] = [];

  for (const pattern of patterns) {
    const patternMatches = matchPattern(artifact, pattern, options?.changedFiles);
    matches.push(...patternMatches);
  }

  return matches;
}

/**
 * Match a single pattern against an artifact.
 */
function matchPattern(artifact: Artifact, pattern: PatternDefinition, changedFiles?: Set<string>): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const detection = pattern.detection;

  if (!detection) {
    return matches;
  }

  let baseFiles = resolveBaseCandidateFiles(artifact, pattern);
  if ((pattern.applicability.filePatterns ?? []).length > 0 && baseFiles.size === 0) {
    return matches;
  }

  // When --changed is active, restrict scanning to changed files only
  if (changedFiles && changedFiles.size > 0) {
    const filtered = new Set<string>();
    for (const f of baseFiles) {
      if (changedFiles.has(f)) filtered.add(f);
    }
    baseFiles = filtered;
    if (baseFiles.size === 0) return matches;
  }

  const baseFileList = [...baseFiles];
  if (!hasRequiredDependencies(pattern, baseFileList, artifact.targetPath)) {
    return matches;
  }
  if (hasExcludedPattern(pattern, baseFileList)) {
    return matches;
  }

  // Check artifact conditions (uses collector output)
  if (detection.artifactConditions) {
    for (const condition of detection.artifactConditions) {
      const conditionMatches = matchArtifactCondition(artifact, pattern, condition);
      matches.push(...conditionMatches);
    }
  }

  // Check code patterns (reads source files)
  if (detection.codePatterns && detection.codePatterns.length > 0) {
    matches.push(...matchCodePatterns(artifact, pattern, baseFiles));
  }

  return matches;
}

function matchCodePatterns(
  artifact: Artifact,
  pattern: PatternDefinition,
  baseFiles: Set<string>
): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const detection = pattern.detection;
  if (!detection?.codePatterns || detection.codePatterns.length === 0) {
    return matches;
  }

  for (const codePattern of detection.codePatterns) {
    const contextInFiles = normalizePatternList(codePattern.context?.inFiles);
    const contextFiles =
      contextInFiles.length > 0
        ? collectFilesFromGlobs(artifact.targetPath, contextInFiles)
        : new Set<string>();

    const candidateFiles = intersectFiles(baseFiles, contextFiles);
    if (candidateFiles.size === 0) {
      continue;
    }

    for (const filePath of candidateFiles) {
      const relativePath = relative(artifact.targetPath, filePath);
      const fileMatches = matchCodePatternInFile(pattern, codePattern, filePath, relativePath);
      matches.push(...fileMatches);
    }
  }

  return matches;
}

function matchCodePatternInFile(
  pattern: PatternDefinition,
  codePattern: CodePattern,
  filePath: string,
  relativePath: string
): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const { lines } = getFileContent(filePath);
  if (lines.length === 0) return matches;

  const functionRanges = getFunctionRanges(filePath);
  const validMatches = collectValidMatches(lines, codePattern, functionRanges);

  if (!codePattern.invert) {
    for (const match of validMatches) {
      matches.push({
        pattern,
        file: relativePath,
        line: match.lineIndex + 1,
        symbol: match.functionRange?.name,
        evidence: buildCodePatternEvidence(codePattern, false),
      });
    }
    return matches;
  }

  const context = codePattern.context;
  if (context?.atFunctionLevel || context?.inFunctions?.length) {
    const targetRanges = functionRanges.filter((range) => {
      if (!context?.inFunctions || context.inFunctions.length === 0) return true;
      return range.name ? context.inFunctions.includes(range.name) : false;
    });

    if (targetRanges.length === 0) return matches;

    for (const range of targetRanges) {
      const hasMatch = validMatches.some(
        (match) =>
          match.functionRange?.name === range.name &&
          match.lineIndex + 1 >= range.startLine &&
          match.lineIndex + 1 <= range.endLine
      );

      if (!hasMatch) {
        matches.push({
          pattern,
          file: relativePath,
          line: range.startLine,
          symbol: range.name,
          evidence: buildCodePatternEvidence(codePattern, true),
        });
      }
    }

    return matches;
  }

  if (validMatches.length === 0) {
    matches.push({
      pattern,
      file: relativePath,
      line: 1,
      evidence: buildCodePatternEvidence(codePattern, true),
    });
  }

  return matches;
}

function collectValidMatches(
  lines: string[],
  codePattern: CodePattern,
  functionRanges: FunctionRange[]
): Array<{ lineIndex: number; functionRange?: FunctionRange }> {
  const matches: Array<{ lineIndex: number; functionRange?: FunctionRange }> = [];
  const andPatterns = normalizePatternList(codePattern.and);
  const notPatterns = normalizePatternList(codePattern.not);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!getMatcher(codePattern.pattern)(line)) continue;
    if (andPatterns.length > 0 && !matchesAll(andPatterns, line)) continue;
    if (notPatterns.length > 0 && !matchesNone(notPatterns, line)) continue;
    if (codePattern.requiresNearby && !meetsNearbyRequirement(lines, i, codePattern.requiresNearby)) continue;

    const functionRange = findFunctionForLine(i + 1, functionRanges);
    if (!passesContext(codePattern.context, functionRange)) continue;

    matches.push({ lineIndex: i, functionRange });
  }

  return matches;
}

function passesContext(
  context: CodePattern['context'] | undefined,
  functionRange: FunctionRange | undefined
): boolean {
  if (!context) return true;

  if (context.atFileLevel && functionRange) return false;
  if (context.atFunctionLevel && !functionRange) return false;

  if (context.inFunctions && context.inFunctions.length > 0) {
    if (!functionRange?.name) return false;
    if (!context.inFunctions.includes(functionRange.name)) return false;
  }

  return true;
}

function buildCodePatternEvidence(codePattern: CodePattern, isMissing: boolean): string[] {
  const evidence: string[] = [];
  const label = isMissing ? 'Missing code pattern' : 'Matched code pattern';
  evidence.push(`${label}: ${codePattern.pattern}`);

  const andPatterns = normalizePatternList(codePattern.and);
  if (andPatterns.length > 0) {
    evidence.push(`Requires: ${andPatterns.join(', ')}`);
  }

  const notPatterns = normalizePatternList(codePattern.not);
  if (notPatterns.length > 0) {
    evidence.push(`Excludes: ${notPatterns.join(', ')}`);
  }

  if (codePattern.requiresNearby) {
    const nearby = codePattern.requiresNearby;
    const window = nearby.within;
    if (nearby.any && nearby.any.length > 0) {
      evidence.push(`Nearby (±${window}): any ${nearby.any.join(', ')}`);
    }
    if (nearby.all && nearby.all.length > 0) {
      evidence.push(`Nearby (±${window}): all ${nearby.all.join(', ')}`);
    }
    if (nearby.not && nearby.not.length > 0) {
      evidence.push(`Nearby (±${window}): none ${nearby.not.join(', ')}`);
    }
  }

  return evidence;
}

/**
 * Match an artifact condition.
 */
function matchArtifactCondition(
  artifact: Artifact,
  pattern: PatternDefinition,
  condition: { type: string; conditions: Record<string, unknown> }
): PatternMatch[] {
  const matches: PatternMatch[] = [];

  switch (condition.type) {
    case 'service':
      matches.push(...matchServiceCondition(artifact, pattern, condition.conditions));
      break;

    case 'transactionScope':
      matches.push(...matchTransactionCondition(artifact, pattern, condition.conditions));
      break;

    case 'webhookHandler':
      matches.push(...matchWebhookCondition(artifact, pattern, condition.conditions));
      break;

    // Add more condition types as needed
  }

  return matches;
}

/**
 * Match service-level conditions.
 */
function matchServiceCondition(
  artifact: Artifact,
  pattern: PatternDefinition,
  conditions: Record<string, unknown>
): PatternMatch[] {
  const matches: PatternMatch[] = [];

  if (!artifact.services) {
    return matches;
  }

  for (const service of artifact.services) {
    let isMatch = true;
    const evidence: string[] = [];

    // Check hasDirective
    const hasDirective = conditions['hasDirective'];
    if (typeof hasDirective === 'string' && hasDirective.length > 0) {
      const filePath = join(artifact.targetPath, service.file);
      const directives = getDirectivePrologue(filePath);
      const hasIt = directives.has(hasDirective);
      if (!hasIt) {
        isMatch = false;
      } else {
        evidence.push(`Has directive: "${hasDirective}"`);
      }
    }

    // Check missingAuthCall
    const missingAuthCall = conditions['missingAuthCall'] === true;
    if (missingAuthCall && isMatch) {
      // Check if there are any auth calls in this service
      const serviceAuthCalls =
        artifact.authzCalls?.filter((a) => a.file === service.file) ?? [];

      if (serviceAuthCalls.length > 0) {
        isMatch = false; // Has auth calls, not missing
      } else {
        evidence.push('No authentication calls found');
      }
    }

    if (isMatch && evidence.length > 0) {
      matches.push({
        pattern,
        file: service.file,
        line: service.line,
        symbol: service.name,
        evidence,
      });
    }
  }

  return matches;
}

/**
 * Match transaction-level conditions.
 */
function matchTransactionCondition(
  artifact: Artifact,
  pattern: PatternDefinition,
  conditions: Record<string, unknown>
): PatternMatch[] {
  const matches: PatternMatch[] = [];

  if (!artifact.transactionScopes) {
    return matches;
  }

  for (const tx of artifact.transactionScopes) {
    let isMatch = true;
    const evidence: string[] = [];

    // Check ORM type
    const orm = conditions['orm'];
    if (typeof orm === 'string' && orm.length > 0) {
      // Collector currently does not emit ORM type; fail closed to avoid false matches.
      isMatch = false;
    }

    // Check for side effects
    const containsSideEffects = conditions['containsSideEffects'] === true;
    if (containsSideEffects && isMatch) {
      const sideEffectTypes = conditions['sideEffectTypes'];
      const allowedTypes = Array.isArray(sideEffectTypes)
        ? sideEffectTypes.filter((t): t is string => typeof t === 'string')
        : undefined;

      const matchingSideEffects = allowedTypes
        ? tx.sideEffects.filter((se) => allowedTypes.includes(se.type))
        : tx.sideEffects;

      if (tx.containsSideEffects && matchingSideEffects.length > 0) {
        evidence.push(
          `Side effects inside transaction: ${matchingSideEffects.map((se) => se.type).join(', ')}`
        );
      } else {
        isMatch = false;
      }
    }

    if (isMatch && evidence.length > 0) {
      matches.push({
        pattern,
        file: tx.file,
        line: tx.line,
        symbol: tx.functionName,
        evidence,
      });
    }
  }

  return matches;
}

/**
 * Match webhook-level conditions.
 */
function matchWebhookCondition(
  artifact: Artifact,
  pattern: PatternDefinition,
  conditions: Record<string, unknown>
): PatternMatch[] {
  const matches: PatternMatch[] = [];

  if (!artifact.webhookHandlers) {
    return matches;
  }

  for (const wh of artifact.webhookHandlers) {
    let isMatch = true;
    const evidence: string[] = [];

    // Check provider
    const provider = conditions['provider'];
    if (typeof provider === 'string' && provider.length > 0) {
      if (wh.provider?.toLowerCase() !== provider.toLowerCase()) {
        isMatch = false;
      } else {
        evidence.push(`Provider: ${wh.provider}`);
      }
    }

    // Check missing signature verification
    const missingSignatureVerification = conditions['missingSignatureVerification'] === true;
    if (missingSignatureVerification && isMatch) {
      const method = wh.signatureVerification?.method;
      if (method && method !== 'none') {
        isMatch = false;
      } else {
        evidence.push('Missing signature verification');
      }
    }

    // Check missing idempotency
    const missingIdempotency = conditions['missingIdempotency'] === true;
    if (missingIdempotency && isMatch) {
      if (wh.hasIdempotencyCheck) {
        isMatch = false; // Has check, not missing
      } else {
        evidence.push('Missing idempotency check');
      }
    }

    if (isMatch && evidence.length > 0) {
      matches.push({
        pattern,
        file: wh.file,
        line: wh.line,
        symbol: wh.handlerName,
        evidence,
      });
    }
  }

  return matches;
}

// ============================================================================
// Pattern Finding Conversion
// ============================================================================

/**
 * Convert pattern matches to findings.
 */
export function patternMatchesToFindings(matches: PatternMatch[], source?: Finding['source']): Finding[] {
  return matches.map((match) => ({
    invariantId: match.pattern.invariantId,
    severity: match.pattern.finding.severity,
    message: match.pattern.finding.message,
    evidence: [
      {
        file: match.file,
        line: match.line,
        symbol: match.symbol,
        context: match.evidence.join('; '),
      },
    ],
    requiredProof: match.pattern.finding.requiredProof,
    suggestedTest: match.pattern.finding.suggestedTest,
    structuredEvidence: {
      summary: `Matched Pro Pattern: ${match.pattern.name ?? match.pattern.id}`,
      signals: match.evidence,
      confidence: 'medium',
    },
    ...(source ? { source } : {}),
  }));
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get statistics about pattern application.
 */
export interface PatternStats {
  patternsLoaded: number;
  patternsApplied: number;
  matchesFound: number;
  frameworksDetected: string[];
  patternsByFramework: Record<string, number>;
}

export function getPatternStats(
  patterns: PatternDefinition[],
  matches: PatternMatch[],
  frameworks: string[]
): PatternStats {
  const patternsByFramework: Record<string, number> = {};
  for (const pattern of patterns) {
    for (const f of pattern.applicability.frameworks) {
      patternsByFramework[f] = (patternsByFramework[f] ?? 0) + 1;
    }
  }

  return {
    patternsLoaded: patterns.length,
    patternsApplied: patterns.length,
    matchesFound: matches.length,
    frameworksDetected: frameworks,
    patternsByFramework,
  };
}

// ============================================================================
// Local Pattern Loading
// ============================================================================

/**
 * Load patterns from a local JSON file.
 * Useful for development and testing without cloud connectivity.
 */
export async function loadPatternsFromFile(filePath: string): Promise<PatternDefinition[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as { patterns?: PatternDefinition[] } | PatternDefinition[];

    // Support both { patterns: [...] } and [...] formats
    if (Array.isArray(data)) {
      return data;
    }
    if (data.patterns && Array.isArray(data.patterns)) {
      return data.patterns;
    }

    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to load patterns from ${filePath}: ${message}`);
  }
}

/**
 * Load patterns from file if it exists, otherwise return empty array.
 * Does not throw on missing file.
 */
export async function loadPatternsFromFileIfExists(filePath: string): Promise<PatternDefinition[]> {
  if (!existsSync(filePath)) {
    return [];
  }
  return loadPatternsFromFile(filePath);
}

// ============================================================================
// Cache Cleanup
// ============================================================================

/**
 * Clear all module-level caches used during pattern matching.
 * Call after applyPatterns() to free memory in large repos.
 */
export function clearPatternCaches(): void {
  fileDirectiveCache.clear();
  fileContentCache.clear();
  functionRangeCache.clear();
  packageJsonCache.clear();
  matcherCache.clear();
  tsProject = null;
}

// ============================================================================
// Bundled Pattern Loading
// ============================================================================

import bundledPatternsData from '../patterns/bundled.json' with { type: 'json' };

/**
 * Load bundled source-level patterns shipped with the CLI.
 * These are open, commodity OWASP-type rules that run locally.
 *
 * Patterns with empty frameworks arrays apply to all codebases.
 * Patterns with specific frameworks are filtered to match the detected set.
 */
export function loadBundledPatterns(frameworks: string[]): PatternDefinition[] {
  const patterns = bundledPatternsData as unknown as PatternDefinition[];
  return patterns.filter(p =>
    p.applicability.frameworks.length === 0 ||
    p.applicability.frameworks.some(f => frameworks.includes(f.toLowerCase()))
  );
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_PATTERN_CONFIG };
export type { PatternConfig, PatternDefinition, PatternCache };
