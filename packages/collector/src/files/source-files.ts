import { Project, SourceFile } from 'ts-morph';
import { glob } from 'glob';
import type { AuditConfig, PartitionOverride } from '../types.js';
import { detectFrameworkContext, type PartitionFrameworkContext } from '../frameworks/context.js';
import { getFrameworkExcludes } from '../frameworks/profiles.js';
import { shouldSkipGeneratedFile, shouldSkipGeneratedPath } from './generated-file.js';
import { shouldSkipTestFile, shouldSkipTestPath } from './test-file.js';

const filePathCache = new Map<string, string[]>();
const sourceFileCache = new Map<string, SourceFile[]>();

// ============================================================================
// SCALABILITY LIMITS
// ============================================================================

/**
 * Maximum number of source files to process before warning/limiting.
 * Repos exceeding this are likely too large for full analysis
 * (e.g., elastic/kibana has 30k+ TS files)
 */
const MAX_SOURCE_FILES = parseInt(process.env['SCHECK_MAX_FILES'] || '20000', 10);

/**
 * Maximum files to parse into AST. Parsing is memory-intensive.
 */
const MAX_PARSED_FILES = parseInt(process.env['SCHECK_MAX_PARSED'] || '10000', 10);

/**
 * Check if we should warn about oversized repos
 */
const WARN_ON_OVERSIZED = process.env['SCHECK_WARN_OVERSIZED'] !== '0';

export interface SourceFileLoaderOptions {
  targetPath: string;
  config: AuditConfig;
  patterns: string[];
  ignore?: string[];
  skipTests?: boolean;
  skipGenerated?: boolean;
}

function toRelativePath(filePath: string, targetPath: string): string {
  const prefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function mergeUnique(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  const merged = [...base];
  for (const entry of extra) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    merged.push(entry);
  }
  return merged;
}

function stripLeadingSlash(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value;
}

function normalizePartitionPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === './' || trimmed === '/') {
    return '';
  }
  let normalized = trimmed.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\//, '');
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

function normalizePartitionOverrideForCache(override: PartitionOverride): PartitionOverride {
  return {
    path: normalizePartitionPath(override.path),
    include: override.include?.map(normalizePattern),
    exclude: override.exclude?.map(normalizePattern),
    servicePatterns: override.servicePatterns?.map(normalizePattern),
    testPatterns: override.testPatterns?.map(normalizePattern),
  };
}

function normalizePartitionOverridesForCache(
  overrides: PartitionOverride[] | undefined
): PartitionOverride[] | undefined {
  if (!overrides) return undefined;
  return overrides.map(normalizePartitionOverrideForCache);
}

type PatternSource = 'include' | 'service' | 'test' | 'custom';

function getPatternSource(patterns: string[], config: AuditConfig): PatternSource {
  if (patterns === config.include) return 'include';
  if (patterns === config.servicePatterns) return 'service';
  if (patterns === config.testPatterns) return 'test';
  return 'custom';
}

function resolvePartitionOverride(
  overrides: PartitionOverride[] | undefined,
  partition: PartitionFrameworkContext
): PartitionOverride | undefined {
  if (!overrides || overrides.length === 0) return undefined;
  const partitionPath = normalizePartitionPath(partition.relativePath);
  let bestMatch: PartitionOverride | undefined;
  let bestLength = -1;

  for (const override of overrides) {
    const overridePath = normalizePartitionPath(override.path);
    if (overridePath === '') {
      if (partitionPath !== '') continue;
    } else if (partitionPath !== overridePath && !partitionPath.startsWith(`${overridePath}/`)) {
      continue;
    }

    if (overridePath.length > bestLength) {
      bestMatch = override;
      bestLength = overridePath.length;
    }
  }

  return bestMatch;
}

function resolvePartitionPatterns(
  patterns: string[],
  config: AuditConfig,
  override?: PartitionOverride
): string[] {
  if (!override) return patterns;
  const source = getPatternSource(patterns, config);
  if (source === 'include' && override.include !== undefined) return override.include;
  if (source === 'service' && override.servicePatterns !== undefined) return override.servicePatterns;
  if (source === 'test' && override.testPatterns !== undefined) return override.testPatterns;
  return patterns;
}

function stripTestExcludes(patterns: string[]): string[] {
  return patterns.filter((pattern) => !pattern.includes('test') && !pattern.includes('spec'));
}

function rebasePatternsForPartition(
  patterns: string[],
  partition: PartitionFrameworkContext
): string[] {
  const normalized = patterns.map(normalizePattern);

  if (partition.kind === 'workspace') {
    return uniqueStrings(
      normalized.filter((pattern) => !pattern.startsWith('apps/') && !pattern.startsWith('packages/'))
    );
  }

  if (partition.kind === 'root') {
    return uniqueStrings(normalized);
  }

  const prefix = partition.kind === 'app' ? 'apps/' : 'packages/';
  const partitionName = partition.relativePath.split('/').pop() ?? '';
  const rebased: string[] = [];

  for (const pattern of normalized) {
    if (pattern.startsWith(prefix)) {
      let stripped = pattern.slice(prefix.length);
      if (partitionName && stripped.startsWith(`${partitionName}/`)) {
        stripped = stripped.slice(partitionName.length + 1);
      }
      stripped = stripLeadingSlash(stripped);
      rebased.push(stripped || '**/*');
      continue;
    }

    if (partition.kind === 'app' && pattern.startsWith('packages/')) continue;
    if (partition.kind === 'package' && pattern.startsWith('apps/')) continue;

    rebased.push(pattern);
  }

  return uniqueStrings(rebased);
}

function buildCacheKey(options: SourceFileLoaderOptions, scope: string): string {
  const { targetPath, patterns, ignore, skipTests = true, skipGenerated = true, config } = options;
  return JSON.stringify({
    scope,
    targetPath,
    patterns: patterns.map(normalizePattern),
    ignore: ignore?.map(normalizePattern),
    skipTests,
    skipGenerated,
    exclude: config.exclude?.map(normalizePattern),
    testFileHandling: config.testFileHandling,
    generatedFileHandling: config.generatedFileHandling,
    partitioning: config.partitioning,
    partitionOverrides: normalizePartitionOverridesForCache(config.partitionOverrides),
  });
}

async function collectPartitionedFilePaths(
  options: SourceFileLoaderOptions,
  partitions: PartitionFrameworkContext[]
): Promise<string[]> {
  const { config, patterns, ignore } = options;
  const files = new Set<string>();
  const patternSource = getPatternSource(patterns, config);

  for (const partition of partitions) {
    const override = resolvePartitionOverride(config.partitionOverrides, partition);
    const partitionPatterns = rebasePatternsForPartition(
      resolvePartitionPatterns(patterns, config, override),
      partition
    );
    if (partitionPatterns.length === 0) continue;

    const frameworkExcludes = getFrameworkExcludes(partition.effectiveFrameworks);
    const workspaceExcludes =
      partition.kind === 'workspace' ? ['apps/**', 'packages/**'] : [];
    const overrideExcludes = override?.exclude?.length
      ? rebasePatternsForPartition(override.exclude, partition)
      : [];
    const filteredOverrideExcludes =
      patternSource === 'test' ? stripTestExcludes(overrideExcludes) : overrideExcludes;
    const ignorePatterns = mergeUnique(
      mergeUnique(ignore ?? config.exclude, filteredOverrideExcludes),
      mergeUnique(frameworkExcludes, workspaceExcludes)
    );

    const partitionFiles = await glob(partitionPatterns, {
      cwd: partition.root,
      absolute: true,
      ignore: ignorePatterns,
    });

    for (const file of partitionFiles) {
      files.add(file);
    }
  }

  return Array.from(files);
}

export async function collectFilePaths(options: SourceFileLoaderOptions): Promise<string[]> {
  const { targetPath, config, patterns, ignore, skipTests = true, skipGenerated = true } = options;
  if (patterns.length === 0) return [];

  const cacheKey = buildCacheKey(options, 'paths');
  const cached = filePathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const usePartitioning = config.partitioning?.enabled ?? true;
  let files: string[];

  if (usePartitioning) {
    const context = await detectFrameworkContext(targetPath);
    files = await collectPartitionedFilePaths(options, context.partitions);
  } else {
    const context = await detectFrameworkContext(targetPath);
    const frameworkExcludes = getFrameworkExcludes(context.frameworks);
    const ignorePatterns = mergeUnique(ignore ?? config.exclude, frameworkExcludes);
    files = await glob(patterns, {
      cwd: targetPath,
      absolute: true,
      ignore: ignorePatterns,
    });
  }

  if (!skipTests && !skipGenerated) {
    const unique = uniqueStrings(files);
    filePathCache.set(cacheKey, unique);
    return unique;
  }

  const filtered = files.filter((file) => {
    const relativePath = toRelativePath(file, targetPath);
    if (skipTests && shouldSkipTestPath(relativePath, config)) return false;
    if (skipGenerated && shouldSkipGeneratedPath(relativePath, config)) return false;
    return true;
  });

  const unique = uniqueStrings(filtered);

  // Scalability check: warn and limit if too many files
  if (unique.length > MAX_SOURCE_FILES) {
    if (WARN_ON_OVERSIZED) {
      console.warn(
        `[collector] Warning: ${unique.length} files exceed limit (${MAX_SOURCE_FILES}). ` +
          `Analysis will be limited. Set SCHECK_MAX_FILES to increase.`
      );
    }
    const limited = unique.slice(0, MAX_SOURCE_FILES);
    filePathCache.set(cacheKey, limited);
    return limited;
  }

  filePathCache.set(cacheKey, unique);
  return unique;
}

export async function loadSourceFiles(options: SourceFileLoaderOptions): Promise<SourceFile[]> {
  const { targetPath, config, skipTests = true, skipGenerated = true } = options;
  const cacheKey = buildCacheKey(options, 'sources');
  const cached = sourceFileCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const allFiles = await collectFilePaths(options);

  if (allFiles.length === 0) {
    sourceFileCache.set(cacheKey, []);
    return [];
  }

  // Scalability: limit files parsed into AST (memory-intensive)
  let files = allFiles;
  if (files.length > MAX_PARSED_FILES) {
    if (WARN_ON_OVERSIZED) {
      console.warn(
        `[collector] Warning: ${files.length} files exceed parse limit (${MAX_PARSED_FILES}). ` +
          `Only first ${MAX_PARSED_FILES} will be parsed. Set SCHECK_MAX_PARSED to increase.`
      );
    }
    files = files.slice(0, MAX_PARSED_FILES);
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
  });

  for (const file of files) {
    try {
      project.addSourceFileAtPath(file);
    } catch {
      // Skip files that can't be parsed
    }
  }

  const sourceFiles = project.getSourceFiles();
  if (!skipTests && !skipGenerated) {
    sourceFileCache.set(cacheKey, sourceFiles);
    return sourceFiles;
  }

  const filtered = sourceFiles.filter((sourceFile) => {
    const relativePath = toRelativePath(sourceFile.getFilePath(), targetPath);
    if (skipTests && shouldSkipTestFile(sourceFile, relativePath, config)) return false;
    if (skipGenerated && shouldSkipGeneratedFile(sourceFile, relativePath, config)) return false;
    return true;
  });

  sourceFileCache.set(cacheKey, filtered);
  return filtered;
}
