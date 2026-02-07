 
/**
 * Data Flow Extractor (Taint Analysis)
 *
 * Tracks how data flows from sources (user input) to sinks (dangerous operations).
 * This enables detection of:
 * - Unvalidated user input reaching database
 * - Unsanitized output (XSS)
 * - Unbounded queries (missing pagination)
 *
 * Key concepts:
 * - Source: Where untrusted data enters (req.body, params, headers)
 * - Sink: Where data is used in sensitive operations (db, file, exec)
 * - Transform: Operations that modify data (sanitize, validate, parse)
 * - Taint: Data that originated from a source and hasn't been sanitized
 */

import { appendFileSync, statSync } from 'fs';
import { SourceFile, Node } from 'ts-morph';
import type {
  ExtractorOptions,
  DataFlowSourceType,
  DataFlowSinkType,
  DataFlowTransformType,
  DataFlowSource,
  DataFlowSink,
  DataFlowTransform,
  DataFlow,
  DataFlowGraph,
} from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

const DATAFLOW_PROGRESS = process.env['SCHECK_DATAFLOW_PROGRESS'] === '1';
const DATAFLOW_PROGRESS_MEM = process.env['SCHECK_DATAFLOW_PROGRESS_MEM'] === '1';
const DATAFLOW_PROGRESS_FILE = process.env['SCHECK_DATAFLOW_PROGRESS_FILE'];
const DATAFLOW_SLOW_MS = Number.parseInt(process.env['SCHECK_DATAFLOW_SLOW_MS'] ?? '', 10);
const DATAFLOW_SLOW_THRESHOLD = Number.isFinite(DATAFLOW_SLOW_MS) && DATAFLOW_SLOW_MS > 0 ? DATAFLOW_SLOW_MS : 0;

// Re-export types for convenience
export type {
  DataFlowSourceType,
  DataFlowSinkType,
  DataFlowTransformType,
  DataFlowSource,
  DataFlowSink,
  DataFlowTransform,
  DataFlow,
  DataFlowGraph,
};

function recordProgress(entry: Record<string, unknown>): void {
  if (!DATAFLOW_PROGRESS_FILE) return;
  try {
    appendFileSync(DATAFLOW_PROGRESS_FILE, `${JSON.stringify(entry)}\n`);
  } catch {
    // Ignore progress logging errors to avoid failing extraction.
  }
}

const SOURCE_PATTERNS: Array<{ pattern: RegExp; type: DataFlowSourceType; accessPath?: string }> = [
  { pattern: /req(?:uest)?\.body\b/, type: 'request_body' },
  { pattern: /request\.json\(\)/, type: 'request_body' },
  { pattern: /req(?:uest)?\.params\b/, type: 'request_params' },
  { pattern: /params\.[a-zA-Z]+/, type: 'request_params' },
  { pattern: /req(?:uest)?\.query\b/, type: 'request_query' },
  { pattern: /searchParams\.get\(|useSearchParams\(\)/, type: 'request_query' },
  { pattern: /req(?:uest)?\.headers\b|request\.headers\.get\(/, type: 'request_headers' },
  { pattern: /req(?:uest)?\.cookies\b|cookies\(\)\.get\(/, type: 'request_cookies' },
  { pattern: /formData\.get\(|new FormData\(/, type: 'form_data' },
  { pattern: /\{ params \}|context\.params/, type: 'url_param' },
  { pattern: /userInput|input\s*[=:]/, type: 'user_input' },
];

const SINK_PATTERNS: Array<{ pattern: RegExp; type: DataFlowSinkType; description: string }> = [
  // Prisma ORM
  { pattern: /\.findMany\(/, type: 'database_query', description: 'Prisma findMany query' },
  { pattern: /\.findFirst\(/, type: 'database_query', description: 'Prisma findFirst query' },
  { pattern: /\.findUnique\(/, type: 'database_query', description: 'Prisma findUnique query' },
  { pattern: /\.create\(/, type: 'database_write', description: 'Prisma create' },
  { pattern: /\.update\(/, type: 'database_write', description: 'Prisma update' },
  { pattern: /\.delete\(/, type: 'database_write', description: 'Prisma delete' },
  { pattern: /\.upsert\(/, type: 'database_write', description: 'Prisma upsert' },

  // Raw SQL
  { pattern: /\$(?:query|execute)Raw(?:Unsafe)?/, type: 'sql_query', description: 'Prisma raw query' },
  { pattern: /(?:knex|sql)\.raw\s*\(/, type: 'sql_query', description: 'raw SQL query' },
  { pattern: /sequelize\.query\s*\(/, type: 'sql_query', description: 'Sequelize raw query' },
  { pattern: /(?:\.createQueryRunner|queryRunner\.query)\s*\(/, type: 'sql_query', description: 'TypeORM query' },
  { pattern: /\.query\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)/i, type: 'sql_query', description: 'Direct SQL query' },
  { pattern: /\.raw\s*\(/, type: 'sql_query', description: 'raw query' },
  { pattern: /sql`[^`]*\$\{/, type: 'sql_query', description: 'SQL template interpolation' },

  // MongoDB
  { pattern: /\.find\s*\(\s*\{/, type: 'nosql_query', description: 'MongoDB find' },
  { pattern: /\.aggregate\s*\(/, type: 'nosql_query', description: 'MongoDB aggregate' },

  // File operations
  { pattern: /(?:fs\.)?readFile\w*\s*\(/, type: 'file_read', description: 'File read' },
  { pattern: /(?:fs\.)?writeFile\w*\s*\(/, type: 'file_write', description: 'File write' },

  // Command execution
  { pattern: /child_process\.(?:exec|spawn|fork)\w*\s*\(/, type: 'command_exec', description: 'child_process' },
  { pattern: /\bexec(?:Async|Sync|File)?\s*\(/, type: 'command_exec', description: 'exec' },
  { pattern: /\bspawn(?:Sync)?\s*\(\s*['"`]/, type: 'command_exec', description: 'spawn' },
  { pattern: /\b(?:cp|proc)\.(?:exec|spawn)\s*\(/, type: 'command_exec', description: 'cp/proc exec' },
  { pattern: /\bexeca(?:\.sync)?\s*\(/, type: 'command_exec', description: 'execa' },
  { pattern: /\bshell(?:js)?\.exec\s*\(/, type: 'command_exec', description: 'shelljs' },

  // Code execution
  { pattern: /eval\s*\(/, type: 'eval', description: 'eval()' },
  { pattern: /new Function\(/, type: 'eval', description: 'new Function()' },

  // Redirects
  { pattern: /res\.redirect\(/, type: 'redirect', description: 'HTTP redirect' },
  { pattern: /redirect\(/, type: 'redirect', description: 'Redirect' },
  { pattern: /NextResponse\.redirect\(/, type: 'redirect', description: 'Next.js redirect' },

  // HTML responses
  { pattern: /res\.send\(/, type: 'html_response', description: 'HTTP response' },
  { pattern: /dangerouslySetInnerHTML/, type: 'html_response', description: 'React dangerouslySetInnerHTML' },

  // Header setting (CRLF injection)
  { pattern: /res\.setHeader\s*\(/, type: 'header_set', description: 'res.setHeader' },
  { pattern: /res\.set\s*\(/, type: 'header_set', description: 'res.set header' },
  { pattern: /response\.headers\.set\s*\(/, type: 'header_set', description: 'response.headers.set' },

  // Cookie setting
  { pattern: /res\.cookie\s*\(/, type: 'cookie_set', description: 'res.cookie' },
  { pattern: /response\.cookie\s*\(/, type: 'cookie_set', description: 'response.cookie' },
  { pattern: /cookies\.set\s*\(/, type: 'cookie_set', description: 'cookies.set' },

  // JWT operations (detect weak verification/signing)
  { pattern: /jwt\.sign\s*\(/, type: 'eval', description: 'jwt.sign' },
  { pattern: /jwt\.verify\s*\(/, type: 'eval', description: 'jwt.verify' },
  { pattern: /jwt\.decode\s*\(/, type: 'eval', description: 'jwt.decode' },

  // Crypto operations (detect weak algorithms/modes)
  { pattern: /create(?:Cipher|Decipher)iv\s*\(/, type: 'command_exec', description: 'crypto.createCipheriv' },
  { pattern: /create(?:Hash|Hmac)\s*\(/, type: 'command_exec', description: 'crypto.createHash' },

  // DOM sinks (XSS)
  { pattern: /\.innerHTML\s*=/, type: 'dom_sink', description: 'innerHTML assignment' },
  { pattern: /document\.write\s*\(/, type: 'dom_sink', description: 'document.write' },
  { pattern: /insertAdjacentHTML\s*\(/, type: 'dom_sink', description: 'insertAdjacentHTML' },
];

const TRANSFORM_PATTERNS: Array<{ pattern: RegExp; type: DataFlowTransformType; description: string }> = [
  // Validation
  { pattern: /\.(?:safe)?[Pp]arse\s*\(/, type: 'validate', description: 'Schema parse' },
  { pattern: /\.validate\s*\(/, type: 'validate', description: 'Validation' },
  { pattern: /(?:joi|yup|zod)\./i, type: 'validate', description: 'Schema validation' },
  // Sanitization
  { pattern: /sanitize|DOMPurify|xss\(|escape|clean/i, type: 'sanitize', description: 'Sanitization' },
  // Encoding
  { pattern: /encodeURI(?:Component)?|htmlEncode/i, type: 'encode', description: 'Encoding' },
  // Parsing
  { pattern: /JSON\.parse|parseInt|parseFloat|Number\(/, type: 'parse', description: 'Parse' },
  // Bounds
  { pattern: /\.(?:slice|substring|substr|take|limit)\s*\(/, type: 'slice', description: 'Bounds' },
  // Filtering
  { pattern: /\.filter\s*\(/, type: 'filter', description: 'Filter' },
];

/**
 * Extract data flow information from the codebase
 */
export async function extractDataFlows(options: ExtractorOptions): Promise<DataFlowGraph> {
  const { targetPath, config } = options;
  const dataflowConfig = config.dataflow ?? {};
  const maxFileBytes =
    dataflowConfig.maxFileBytes && dataflowConfig.maxFileBytes > 0 ? dataflowConfig.maxFileBytes : 0;
  const maxFileLines =
    dataflowConfig.maxFileLines && dataflowConfig.maxFileLines > 0 ? dataflowConfig.maxFileLines : 0;

  const sources: DataFlowSource[] = [];
  const sinks: DataFlowSink[] = [];
  const transforms: DataFlowTransform[] = [];
  const flows: DataFlow[] = [];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return { sources, sinks, transforms, flows };
  }

  for (let index = 0; index < sourceFiles.length; index++) {
    const sourceFile = sourceFiles[index]!;
    const filePath = sourceFile.getFilePath();
    const relativePath = filePath.replace(targetPath + '/', '');
    const fileLabel = `${index + 1}/${sourceFiles.length} ${relativePath}`;
    let skipReason: string | undefined;
    let fileSize: number | undefined;
    let lineCount: number | undefined;

    if (maxFileBytes > 0) {
      try {
        fileSize = statSync(filePath).size;
      } catch {
        fileSize = 0;
      }
      if (fileSize > maxFileBytes) {
        skipReason = 'max_file_bytes';
      }
    }

    if (!skipReason && maxFileLines > 0) {
      lineCount = sourceFile.getEndLineNumber();
      if (lineCount > maxFileLines) {
        skipReason = 'max_file_lines';
      }
    }

    if (skipReason) {
      if (DATAFLOW_PROGRESS) {
        const extra = [
          skipReason ? `reason=${skipReason}` : '',
          fileSize !== undefined ? `bytes=${fileSize}` : '',
          lineCount !== undefined ? `lines=${lineCount}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        console.log(`[dataflow] skip ${fileLabel}${extra ? ` ${extra}` : ''}`);
      }
      recordProgress({
        event: 'skip',
        index: index + 1,
        total: sourceFiles.length,
        file: relativePath,
        reason: skipReason,
        fileSize,
        lineCount,
        skippedAt: new Date().toISOString(),
      });
      continue;
    }
    const fileStart = Date.now();
    const memStart = DATAFLOW_PROGRESS_MEM || DATAFLOW_SLOW_THRESHOLD > 0 ? process.memoryUsage() : undefined;
    if (DATAFLOW_PROGRESS) {
      console.log(`[dataflow] start ${fileLabel}`);
    }
    recordProgress({
      event: 'start',
      index: index + 1,
      total: sourceFiles.length,
      file: relativePath,
      startedAt: new Date().toISOString(),
      mem: memStart,
    });

    // Extract sources, sinks, and transforms from this file
    const fileSources = extractSourcesFromFile(sourceFile, relativePath);
    const fileSinks = extractSinksFromFile(sourceFile, relativePath);
    const fileTransforms = extractTransformsFromFile(sourceFile, relativePath);

    sources.push(...fileSources);
    sinks.push(...fileSinks);
    transforms.push(...fileTransforms);

    // Try to connect flows within the same file
    const fileFlows = connectFlows(fileSources, fileSinks, fileTransforms, relativePath);
    flows.push(...fileFlows);

    const elapsedMs = Date.now() - fileStart;
    const isSlow = DATAFLOW_SLOW_THRESHOLD > 0 && elapsedMs >= DATAFLOW_SLOW_THRESHOLD;
    const memEnd = DATAFLOW_PROGRESS_MEM || isSlow ? process.memoryUsage() : undefined;
    if (DATAFLOW_PROGRESS) {
      console.log(
        `[dataflow] done ${fileLabel} (${elapsedMs}ms) sources=${fileSources.length} sinks=${fileSinks.length} transforms=${fileTransforms.length} flows=${fileFlows.length}`
      );
    }
    if (isSlow) {
      let slowFileSize = fileSize;
      if (slowFileSize === undefined) {
        try {
          slowFileSize = statSync(filePath).size;
        } catch {
          slowFileSize = 0;
        }
      }
      const slowLineCount = lineCount ?? sourceFile.getEndLineNumber();
      console.log(
        `[dataflow] slow ${fileLabel} (${elapsedMs}ms) bytes=${slowFileSize} lines=${slowLineCount} sources=${fileSources.length} sinks=${fileSinks.length} transforms=${fileTransforms.length} flows=${fileFlows.length}`
      );
    }
    recordProgress({
      event: 'done',
      index: index + 1,
      total: sourceFiles.length,
      file: relativePath,
      elapsedMs,
      sources: fileSources.length,
      sinks: fileSinks.length,
      transforms: fileTransforms.length,
      flows: fileFlows.length,
      slow: isSlow,
      mem: memEnd,
    });
  }

  return { sources, sinks, transforms, flows };
}

/**
 * Extract data sources from a file
 */
function extractSourcesFromFile(sourceFile: SourceFile, relativePath: string): DataFlowSource[] {
  const sources: DataFlowSource[] = [];

  // Find function context for each match
  sourceFile.forEachDescendant((node) => {
    const nodeText = node.getText();
    const line = node.getStartLineNumber();

    for (const { pattern, type } of SOURCE_PATTERNS) {
      if (pattern.test(nodeText)) {
        // Get the containing function name
        const functionContext = getFunctionContext(node);

        // Try to get the variable name this is assigned to
        const variable = getAssignedVariable(node);

        sources.push({
          file: relativePath,
          line,
          type,
          variable: variable ?? 'input',
          functionContext,
          accessPath: extractAccessPath(nodeText, pattern),
        });
        break;  // Only match first pattern per node
      }
    }
  });

  return deduplicateSources(sources);
}

/**
 * Extract data sinks from a file
 */
function extractSinksFromFile(sourceFile: SourceFile, relativePath: string): DataFlowSink[] {
  const sinks: DataFlowSink[] = [];

  sourceFile.forEachDescendant((node) => {
    const nodeText = node.getText();
    const line = node.getStartLineNumber();

    // Call expression sinks
    if (Node.isCallExpression(node)) {
      for (const { pattern, type, description } of SINK_PATTERNS) {
        if (pattern.test(nodeText)) {
          const functionContext = getFunctionContext(node);
          const taintedInputs = extractTaintedInputs(node);
          // Include snippet of actual call text for richer context
          const snippet = nodeText.length > 120 ? nodeText.slice(0, 120) : nodeText;

          sinks.push({
            file: relativePath,
            line,
            type,
            functionContext,
            context: `${description}: ${snippet}`,
            taintedInputs,
          });
          break;
        }
      }
      return;
    }

    // Assignment-based sinks (e.g. innerHTML =)
    if (Node.isBinaryExpression(node) || Node.isPropertyAccessExpression(node)) {
      for (const { pattern, type, description } of SINK_PATTERNS) {
        if (type !== 'dom_sink') continue;
        if (pattern.test(nodeText)) {
          const functionContext = getFunctionContext(node);
          const taintedInputs = extractTaintedInputs(node);
          sinks.push({
            file: relativePath,
            line,
            type,
            functionContext,
            context: description,
            taintedInputs,
          });
          break;
        }
      }
    }
  });

  return sinks;
}

/**
 * Extract transforms from a file
 */
function extractTransformsFromFile(sourceFile: SourceFile, relativePath: string): DataFlowTransform[] {
  const transforms: DataFlowTransform[] = [];

  sourceFile.forEachDescendant((node) => {
    const nodeText = node.getText();
    const line = node.getStartLineNumber();

    for (const { pattern, type, description } of TRANSFORM_PATTERNS) {
      if (pattern.test(nodeText)) {
        const functionContext = getFunctionContext(node);
        const inputVariable = extractInputVariable(node);
        const outputVariable = getAssignedVariable(node);

        transforms.push({
          file: relativePath,
          line,
          type,
          inputVariable: inputVariable ?? 'input',
          outputVariable,
          functionContext,
          description,
        });
        break;
      }
    }
  });

  return transforms;
}

// Admin context detection patterns (2026-01-09 accuracy fix)
const ADMIN_PATH_PATTERNS = [
  /\/admin\//i, /\/dashboard\//i, /\/internal\//i, /\/backoffice\//i,
  /admin\.ts$/i, /admin-.*\.ts$/i,
];

const ADMIN_FUNCTION_PATTERNS = [/^admin/i, /Admin$/, /^internal/i, /^superuser/i];

const UNTRUSTED_SOURCE_TYPES: DataFlowSourceType[] = [
  'request_body', 'request_params', 'request_query', 'request_headers',
  'request_cookies', 'form_data', 'url_param', 'user_input',
];

function isAdminContext(filePath: string, functionContext?: string): boolean {
  // Check file path
  if (ADMIN_PATH_PATTERNS.some(p => p.test(filePath))) {
    return true;
  }
  // Check function name
  if (functionContext && ADMIN_FUNCTION_PATTERNS.some(p => p.test(functionContext))) {
    return true;
  }
  return false;
}

/**
 * Connect sources to sinks through transforms
 */
function connectFlows(
  sources: DataFlowSource[],
  sinks: DataFlowSink[],
  transforms: DataFlowTransform[],
  file: string
): DataFlow[] {
  const flows: DataFlow[] = [];

  // For each sink, try to find a source that flows into it
  for (const sink of sinks) {
    for (const source of sources) {
      // Check if they're in the same function
      if (source.functionContext !== sink.functionContext) continue;

      // Check if the source variable appears in the sink's inputs
      // Strategy (a): exact/substring match on source.variable
      const sourceVars = source.variable.toLowerCase().split(',');
      const sinkInputsLower = sink.taintedInputs.map(i => i.toLowerCase());

      let isConnected = sourceVars.some(sv =>
        sinkInputsLower.some(input => input.includes(sv) || sv.includes(input))
      );

      // Strategy (b): access path leaf match
      if (!isConnected && source.accessPath) {
        const leafVar = source.accessPath.split('.').pop()?.toLowerCase();
        if (leafVar && leafVar.length > 1) {
          isConnected = sinkInputsLower.some(i => i === leafVar || i.includes(leafVar));
        }
      }

      // Strategy (c): same-function proximity fallback for unresolved untrusted sources
      if (!isConnected && sourceVars.includes('input') &&
          source.functionContext && UNTRUSTED_SOURCE_TYPES.includes(source.type)) {
        isConnected = true;
      }

      if (isConnected) {
        // Find transforms between source and sink
        const relevantTransforms = transforms.filter(
          t => t.functionContext === source.functionContext &&
               t.line > source.line &&
               t.line < sink.line
        );

        // Check if any transform is a sanitizer or validator
        const isSanitized = relevantTransforms.some(t => t.type === 'sanitize');
        const isValidated = relevantTransforms.some(t => t.type === 'validate');

        // Check if this is in an admin-protected context (reduces severity)
        const isAdminProtected = isAdminContext(file, source.functionContext);

        flows.push({
          source,
          sink,
          transforms: relevantTransforms,
          isSanitized,
          isValidated,
          isAdminProtected,
          flowPath: buildFlowPath(source, relevantTransforms, sink),
        });
      }
    }
  }

  return flows;
}

function getFunctionContext(node: Node): string | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      return current.getName();
    }
    if (Node.isMethodDeclaration(current)) {
      return current.getName();
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const parent = current.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
    }
    current = current.getParent();
  }
  return undefined;
}

function getAssignedVariable(node: Node): string | undefined {
  let current: Node | undefined = node;
  // Walk up to find the variable declaration (handles nested expressions)
  while (current) {
    const parent = current.getParent();
    if (Node.isVariableDeclaration(parent)) {
      // Check if the declaration uses destructuring (ObjectBindingPattern)
      const nameNode = parent.getNameNode();
      if (Node.isObjectBindingPattern(nameNode)) {
        const names = nameNode.getElements().map(el => el.getName());
        if (names.length > 0) return names.join(',');
      } else if (Node.isArrayBindingPattern(nameNode)) {
        const names = nameNode.getElements()
          .filter((el): el is import('ts-morph').BindingElement => Node.isBindingElement(el))
          .map(el => el.getName());
        if (names.length > 0) return names.join(',');
      } else {
        return parent.getName();
      }
    }
    if (Node.isPropertyAssignment(parent)) {
      return parent.getName();
    }
    // Don't walk past function boundaries
    if (Node.isFunctionDeclaration(parent) || Node.isArrowFunction(parent) ||
        Node.isFunctionExpression(parent) || Node.isMethodDeclaration(parent)) {
      break;
    }
    current = parent;
  }
  return undefined;
}

function extractAccessPath(text: string, _pattern: RegExp): string {
  // Extract the full access path like "req.body.email"
  const match = text.match(/(?:req(?:uest)?|params|query|body|headers|cookies)\.[a-zA-Z_.[\]]+/);
  return match ? match[0] : text.slice(0, 50);
}

function extractTaintedInputs(node: Node): string[] {
  const inputs: string[] = [];

  // Get all identifiers used in the call
  node.forEachDescendant((child) => {
    if (Node.isIdentifier(child)) {
      const name = child.getText();
      // Skip common non-tainted names
      if (!['console', 'JSON', 'Object', 'Array', 'Math', 'Date', 'String', 'Number', 'Boolean', 'Error', 'Promise', 'undefined', 'null', 'true', 'false'].includes(name)) {
        inputs.push(name);
      }
    }
  });

  return [...new Set(inputs)];
}

function extractInputVariable(node: Node): string | undefined {
  // Try to find the input to this transform
  if (Node.isCallExpression(node)) {
    const args = node.getArguments();
    if (args.length > 0) {
      const firstArg = args[0];
      if (firstArg && Node.isIdentifier(firstArg)) {
        return firstArg.getText();
      }
    }
  }
  return undefined;
}

function buildFlowPath(
  source: DataFlowSource,
  transforms: DataFlowTransform[],
  sink: DataFlowSink
): string[] {
  const path: string[] = [source.variable];

  for (const t of transforms) {
    if (t.outputVariable) {
      path.push(t.outputVariable);
    }
  }

  if (sink.taintedInputs.length > 0) {
    path.push(sink.taintedInputs[0]!);
  }

  return path;
}

function deduplicateSources(sources: DataFlowSource[]): DataFlowSource[] {
  const seen = new Set<string>();
  return sources.filter(s => {
    const key = `${s.file}:${s.line}:${s.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default extractDataFlows;
