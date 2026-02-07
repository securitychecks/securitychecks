/**
 * Jobs Extractor
 *
 * Extracts background job handler information to verify retry safety patterns.
 * Detects:
 * - Trigger.dev tasks (schemaTask, task)
 * - BullMQ workers and processors
 * - Inngest functions
 * - Idempotency patterns in job handlers
 */

import { SourceFile, Node } from 'ts-morph';
import type { JobHandler, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

// ============================================================================
// Framework Detection Patterns
// ============================================================================

type JobFramework = 'trigger' | 'bullmq' | 'inngest' | 'custom';

// Patterns to identify job-related files
const JOB_FILE_PATTERNS = [
  /\/jobs?\//i,
  /\/workers?\//i,
  /\/tasks?\//i,
  /\/queues?\//i,
  /\/triggers?\//i,
  /\/inngest\//i,
  /\.job\.ts$/i,
  /\.worker\.ts$/i,
  /\.task\.ts$/i,
];

// Files that should NEVER be considered job files
const NON_JOB_FILE_PATTERNS = [
  /\.e2e-spec\.ts$/i,           // E2E tests
  /\.spec\.ts$/i,               // Unit tests
  /\.test\.ts$/i,               // Unit tests
  /\/__tests__\//i,             // Test directories
  /\/test\//i,                  // Test directories
  /vite\.config\./i,            // Vite config
  /jest\.config\./i,            // Jest config
  /vitest\.config\./i,          // Vitest config
  /tsconfig/i,                  // TypeScript config
  /eslint/i,                    // ESLint config
  /prettier/i,                  // Prettier config
  /webpack\.config/i,           // Webpack config
  /rollup\.config/i,            // Rollup config
  /\.d\.ts$/i,                  // Type definition files
  /\/types\//i,                 // Type directories
  /\/mocks?\//i,                // Mock directories
  /\/fixtures?\//i,             // Test fixtures
];

// Import patterns for each framework
const FRAMEWORK_IMPORTS: Record<JobFramework, RegExp[]> = {
  trigger: [
    /@trigger\.dev\/sdk/,
    /from\s+['"]@trigger\.dev/,
  ],
  bullmq: [
    /from\s+['"]bullmq['"]/,
    /from\s+['"]bull['"]/,
  ],
  inngest: [
    /from\s+['"]inngest['"]/,
    /@inngest\//,
  ],
  custom: [],
};

// Function/variable patterns for each framework
const FRAMEWORK_PATTERNS: Record<JobFramework, RegExp[]> = {
  trigger: [
    /schemaTask\s*\(/,
    /task\s*\(\s*\{/,
    /\.task\s*\(/,
  ],
  bullmq: [
    /new\s+Worker\s*\(/,
    /new\s+Queue\s*\(/,
    /\.process\s*\(/,
    /processor\s*:/,
  ],
  inngest: [
    /createFunction\s*\(/,
    /inngest\.createFunction\s*\(/,
    /\.createFunction\s*\(/,
  ],
  custom: [
    /defineJob\s*\(/,
    /registerJob\s*\(/,
    /addJob\s*\(/,
    /process\w*Job\s*\(/i,
    /handle\w*Job\s*\(/i,
    /run\w*Job\s*\(/i,
  ],
};

// Idempotency patterns in job handlers
const IDEMPOTENCY_PATTERNS = [
  /idempotency/i,
  /idempotent/i,
  /dedup/i,
  /deduplicate/i,
  /alreadyProcessed/i,
  /processedJobs/i,
  /jobId.*exists/i,
  /findUnique.*jobId/i,
  /upsert/i,  // Often indicates idempotent updates
];

// ============================================================================
// Extractor Implementation
// ============================================================================

export async function extractJobs(options: ExtractorOptions): Promise<JobHandler[]> {
  const { targetPath, config } = options;
  const jobs: JobHandler[] = [];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return jobs;
  }

  // Extract job handlers from each file
  for (const sourceFile of sourceFiles) {
    const fileJobs = extractJobsFromFile(sourceFile, targetPath);
    jobs.push(...fileJobs);
  }

  return jobs;
}

function extractJobsFromFile(sourceFile: SourceFile, targetPath: string): JobHandler[] {
  const jobs: JobHandler[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');
  const fileText = sourceFile.getFullText();

  // Detect framework from imports
  const framework = detectFramework(fileText);

  // First check exclusions - never process these files
  if (NON_JOB_FILE_PATTERNS.some((p) => p.test(relativePath))) {
    return jobs;
  }

  // Check if this file is likely a job file
  const isJobFile =
    JOB_FILE_PATTERNS.some((p) => p.test(relativePath)) ||
    framework !== null ||
    FRAMEWORK_PATTERNS.custom.some((p) => p.test(fileText));

  if (!isJobFile) {
    return jobs;
  }

  // Find job handler definitions
  sourceFile.forEachDescendant((node) => {
    // Check for expressions that define jobs (trigger.dev, inngest, BullMQ Worker)
    if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
      const jobHandler = analyzeJobExpression(node, relativePath);
      if (jobHandler) {
        jobs.push(jobHandler);
      }
    }

    // Check for NestJS @Processor classes with @Process methods (BullMQ)
    if (Node.isClassDeclaration(node)) {
      const nestJsJobs = analyzeNestJsProcessor(node, relativePath);
      jobs.push(...nestJsJobs);
    }

    // Check for exported function declarations matching custom job patterns
    if (Node.isFunctionDeclaration(node) && node.isExported()) {
      const fnName = node.getName();
      if (fnName) {
        const isCustomJob = FRAMEWORK_PATTERNS.custom.some(p => p.test(`${fnName}(`));
        if (isCustomJob) {
          const hasIdempotency = IDEMPOTENCY_PATTERNS.some(p => p.test(node.getText()));
          jobs.push({
            file: relativePath,
            line: node.getStartLineNumber(),
            name: fnName,
            hasIdempotencyCheck: hasIdempotency,
            framework: 'custom',
          });
        }
      }
    }
  });

  return jobs;
}

// Analyze NestJS @Processor decorated classes for @Process methods
function analyzeNestJsProcessor(node: Node, file: string): JobHandler[] {
  if (!Node.isClassDeclaration(node)) return [];

  const decorators = node.getDecorators();
  const processorDecorator = decorators.find((d) => /@Processor\s*\(/.test(d.getText()));

  if (!processorDecorator) return [];

  // Get the queue name from @Processor('queue-name')
  const processorText = processorDecorator.getText();
  const queueMatch = processorText.match(/@Processor\s*\(\s*['"`]?([^'"`),]+)['"`]?\s*\)/);
  const queueName = queueMatch?.[1] ?? 'unknown';

  const jobs: JobHandler[] = [];

  // Find all @Process decorated methods
  node.forEachDescendant((child) => {
    if (!Node.isMethodDeclaration(child)) return;

    const methodDecorators = child.getDecorators();
    const processDecorator = methodDecorators.find((d) => /@Process\s*\(/.test(d.getText()));

    if (!processDecorator) return;

    // Get job name from @Process('job-name') or use method name
    const processText = processDecorator.getText();
    const jobMatch = processText.match(/@Process\s*\(\s*['"`]?([^'"`),]+)['"`]?\s*\)/);
    const methodName = child.getName();
    const jobName = jobMatch?.[1] ?? methodName;

    // Check for idempotency patterns in method body
    const methodText = child.getText();
    const hasIdempotency = IDEMPOTENCY_PATTERNS.some((p) => p.test(methodText));

    jobs.push({
      file,
      line: child.getStartLineNumber(),
      name: `${queueName}:${jobName}`,
      hasIdempotencyCheck: hasIdempotency,
      framework: 'bullmq',
    });
  });

  return jobs;
}

function detectFramework(fileText: string): JobFramework | null {
  for (const [framework, patterns] of Object.entries(FRAMEWORK_IMPORTS) as [JobFramework, RegExp[]][]) {
    if (framework === 'custom') continue;
    if (patterns.some((p) => p.test(fileText))) {
      return framework;
    }
  }
  return null;
}

function analyzeJobExpression(node: Node, file: string): JobHandler | null {
  const callText = node.getText();
  const line = node.getStartLineNumber();

  // Check for trigger.dev patterns - ONLY match schemaTask or task({...})
  // The pattern must start with schemaTask( or task({
  if (/^schemaTask\s*\(/.test(callText) || /^task\s*\(\s*\{/.test(callText)) {
    const name = extractJobName(node, callText) ?? extractVariableName(node) ?? 'unnamed_task';
    const hasIdempotency = checkIdempotency(node);

    return {
      file,
      line,
      name,
      hasIdempotencyCheck: hasIdempotency,
      framework: 'trigger',
    };
  }

  // Check for bullmq patterns - ONLY match new Worker(...)
  if (/^new\s+Worker\s*\(/.test(callText)) {
    const name = extractBullMQName(callText) ?? 'unnamed_worker';
    const hasIdempotency = checkIdempotency(node);

    return {
      file,
      line,
      name,
      hasIdempotencyCheck: hasIdempotency,
      framework: 'bullmq',
    };
  }

  // Check for inngest patterns - ONLY match createFunction(...)
  if (/^createFunction\s*\(/.test(callText) || /^inngest\.createFunction\s*\(/.test(callText)) {
    const name = extractInngestName(callText) ?? 'unnamed_function';
    const hasIdempotency = checkIdempotency(node);

    return {
      file,
      line,
      name,
      hasIdempotencyCheck: hasIdempotency,
      framework: 'inngest',
    };
  }

  // Check for custom job patterns (processEmailJob, handlePaymentJob, etc.)
  for (const pattern of FRAMEWORK_PATTERNS.custom) {
    if (pattern.test(callText)) {
      const name = extractVariableName(node) ?? callText.match(/(\w+)\s*\(/)?.[1] ?? 'unnamed_job';
      const hasIdempotency = checkIdempotency(node);
      return {
        file,
        line,
        name,
        hasIdempotencyCheck: hasIdempotency,
        framework: 'custom',
      };
    }
  }

  return null;
}

// Extract variable name when a task is assigned to a const/let
function extractVariableName(node: Node): string | undefined {
  const parent = node.getParent();
  if (parent && Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }
  return undefined;
}


function extractJobName(node: Node, callText: string): string | undefined {
  // Look for id property in object argument
  // schemaTask({ id: "booking.send.confirm.notifications", ... })
  const idMatch = callText.match(/id\s*:\s*['"`]([^'"`]+)['"`]/);
  if (idMatch?.[1]) {
    return idMatch[1];
  }

  // Look for name property
  const nameMatch = callText.match(/name\s*:\s*['"`]([^'"`]+)['"`]/);
  if (nameMatch?.[1]) {
    return nameMatch[1];
  }

  // Try to get from variable name
  const parent = node.getParent();
  if (parent && Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }

  return undefined;
}

function extractBullMQName(callText: string): string | undefined {
  // new Worker('queue-name', processor)
  const match = callText.match(/new\s+Worker\s*\(\s*['"`]([^'"`]+)['"`]/);
  return match?.[1];
}

function extractInngestName(callText: string): string | undefined {
  // createFunction({ id: 'function-name' }, ...)
  const idMatch = callText.match(/id\s*:\s*['"`]([^'"`]+)['"`]/);
  if (idMatch?.[1]) {
    return idMatch[1];
  }

  // createFunction({ name: 'function-name' }, ...)
  const nameMatch = callText.match(/name\s*:\s*['"`]([^'"`]+)['"`]/);
  return nameMatch?.[1];
}

function checkIdempotency(node: Node): boolean {
  // Get the full text of the function including its body
  const fullText = node.getText();

  // Check for idempotency patterns
  return IDEMPOTENCY_PATTERNS.some((p) => p.test(fullText));
}

export default extractJobs;
