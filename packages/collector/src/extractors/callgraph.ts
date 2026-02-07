/**
 * Call Graph Extractor
 *
 * Builds a call graph showing which functions call which other functions.
 * This enables tracking auth propagation through call chains.
 *
 * Features:
 * - Cross-file resolution via import tracking
 * - Aliased import support (import { foo as bar })
 * - Namespace import support (import * as ns)
 * - Bidirectional edges (calls + calledBy)
 *
 * Example:
 *   handleRequest -> userService.getUser -> db.findUser
 *   If auth is checked in handleRequest, then getUser and findUser are protected.
 */

import { SourceFile, Node, CallExpression } from 'ts-morph';
import type { ExtractorOptions } from '../types.js';
import {
  buildImportGraph,
  resolveCall,
  type ImportGraph,
  type FileImports,
} from './imports.js';
import { loadSourceFiles } from '../files/source-files.js';

// ============================================================================
// SCALABILITY LIMITS
// ============================================================================

/**
 * Maximum nodes in call graph before stopping.
 * Prevents V8 Map overflow (~16.7M entries max)
 */
const MAX_CALLGRAPH_NODES = parseInt(process.env['SCHECK_MAX_CALLGRAPH_NODES'] || '500000', 10);

/**
 * Warn when approaching limit
 */
const WARN_ON_LIMIT = process.env['SCHECK_WARN_OVERSIZED'] !== '0';

export interface CallGraphNode {
  file: string;
  line: number;
  functionName: string;
  // Functions this function calls
  calls: Array<{
    targetFunction: string;
    targetFile?: string;
    // Original name if different from targetFunction (aliased imports)
    originalName?: string;
    line: number;
  }>;
  // Functions that call this function (populated after building full graph)
  calledBy?: Array<{
    callerFunction: string;
    callerFile: string;
  }>;
}

export interface CallGraph {
  nodes: Map<string, CallGraphNode>;
  // Quick lookup: functionName -> all nodes with that name
  byName: Map<string, CallGraphNode[]>;
  // Import graph for cross-file resolution
  importGraph: ImportGraph;
}

function nodeKey(node: Pick<CallGraphNode, 'file' | 'functionName' | 'line'>): string {
  return `${node.file}:${node.functionName}:${node.line}`;
}

/**
 * Build a call graph from the codebase
 */
export async function buildCallGraph(options: ExtractorOptions): Promise<CallGraph> {
  const { targetPath, config } = options;
  const nodes = new Map<string, CallGraphNode>();
  const byName = new Map<string, CallGraphNode[]>();

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.include,
  });

  if (sourceFiles.length === 0) {
    return { nodes, byName, importGraph: { files: new Map(), exports: new Map() } };
  }

  // Build import graph first for cross-file resolution
  const importGraph = buildImportGraph(sourceFiles, targetPath);

  // First pass: Extract all function definitions and their calls
  let hitLimit = false;
  for (const sourceFile of sourceFiles) {
    // Scalability: check if we've hit the node limit
    if (nodes.size >= MAX_CALLGRAPH_NODES) {
      if (WARN_ON_LIMIT && !hitLimit) {
        console.warn(
          `[collector] Call graph node limit reached (${MAX_CALLGRAPH_NODES}). ` +
            `Stopping early. Set SCHECK_MAX_CALLGRAPH_NODES to increase.`
        );
        hitLimit = true;
      }
      break;
    }

    const filePath = sourceFile.getFilePath();
    const relativePath = filePath.replace(targetPath + '/', '');
    const fileImports = importGraph.files.get(relativePath);

    const fileNodes = extractCallGraphFromFile(sourceFile, targetPath, fileImports, importGraph);
    for (const node of fileNodes) {
      // Double-check limit for large files
      if (nodes.size >= MAX_CALLGRAPH_NODES) break;

      nodes.set(nodeKey(node), node);

      // Add to byName index
      if (!byName.has(node.functionName)) {
        byName.set(node.functionName, []);
      }
      byName.get(node.functionName)!.push(node);
    }
  }

  // Second pass: Build reverse edges (calledBy) with improved resolution
  for (const node of nodes.values()) {
    for (const call of node.calls) {
      const targetName = call.originalName ?? call.targetFunction;

      // Use resolved targetFile if available, otherwise fall back to byName lookup
      if (call.targetFile) {
        const candidates = (byName.get(targetName) ?? []).filter((n) => n.file === call.targetFile);
        if (candidates.length > 0) {
          for (const targetNode of candidates) {
            if (!targetNode.calledBy) {
              targetNode.calledBy = [];
            }
            const exists = targetNode.calledBy.some(
              (c) => c.callerFunction === node.functionName && c.callerFile === node.file
            );
            if (!exists) {
              targetNode.calledBy.push({
                callerFunction: node.functionName,
                callerFile: node.file,
              });
            }
          }
          continue;
        }
      }

      // Fall back to name-based lookup
      const targetNodes = byName.get(targetName) ?? [];
      for (const targetNode of targetNodes) {
        if (!targetNode.calledBy) {
          targetNode.calledBy = [];
        }
        // Avoid duplicates
        const exists = targetNode.calledBy.some(
          (c) => c.callerFunction === node.functionName && c.callerFile === node.file
        );
        if (!exists) {
          targetNode.calledBy.push({
            callerFunction: node.functionName,
            callerFile: node.file,
          });
        }
      }
    }
  }

  return { nodes, byName, importGraph };
}

function extractCallGraphFromFile(
  sourceFile: SourceFile,
  targetPath: string,
  fileImports: FileImports | undefined,
  importGraph: ImportGraph
): CallGraphNode[] {
  const nodes: CallGraphNode[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');

  // Find all function declarations
  sourceFile.forEachDescendant((node) => {
    let functionName: string | undefined;
    let line: number | undefined;
    let functionNode: Node | undefined;

    if (Node.isFunctionDeclaration(node)) {
      functionName = node.getName();
      line = node.getStartLineNumber();
      functionNode = node;
    } else if (Node.isMethodDeclaration(node)) {
      functionName = node.getName();
      line = node.getStartLineNumber();
      functionNode = node;
    } else if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const parent = node.getParent();
      if (Node.isVariableDeclaration(parent)) {
        functionName = parent.getName();
        line = node.getStartLineNumber();
        functionNode = node;
      } else if (Node.isPropertyAssignment(parent)) {
        functionName = parent.getName();
        line = node.getStartLineNumber();
        functionNode = node;
      }
    }

    if (functionName && line && functionNode) {
      const calls = extractCallsFromFunction(functionNode, fileImports, importGraph);
      nodes.push({
        file: relativePath,
        line,
        functionName,
        calls,
      });
    }
  });

  return nodes;
}

function extractCallsFromFunction(
  functionNode: Node,
  fileImports: FileImports | undefined,
  importGraph: ImportGraph
): CallGraphNode['calls'] {
  const calls: CallGraphNode['calls'] = [];
  const seen = new Set<string>();

  functionNode.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const callInfo = getCallInfo(node, fileImports, importGraph);
    if (callInfo) {
      const key = `${callInfo.targetFile ?? ''}:${callInfo.targetFunction}:${callInfo.originalName ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        calls.push(callInfo);
      }
    }
  });

  return calls;
}

function getCallInfo(
  node: CallExpression,
  fileImports: FileImports | undefined,
  _importGraph: ImportGraph
): CallGraphNode['calls'][0] | null {
  const expression = node.getExpression();
  const line = node.getStartLineNumber();

  // Simple function call: myFunction()
  if (Node.isIdentifier(expression)) {
    const localName = expression.getText();

    // Try to resolve through imports
    if (fileImports) {
      const resolved = resolveCall(localName, undefined, fileImports);
      if (resolved) {
        return {
          targetFunction: localName,
          originalName: resolved.originalName !== localName ? resolved.originalName : undefined,
          targetFile: resolved.sourceFile,
          line,
        };
      }
    }

    return {
      targetFunction: localName,
      line,
    };
  }

  // Method call: object.method() or service.function()
  if (Node.isPropertyAccessExpression(expression)) {
    const methodName = expression.getName();
    const objectExpr = expression.getExpression();

    // Get the object name for context
    let objectName = '';
    if (Node.isIdentifier(objectExpr)) {
      objectName = objectExpr.getText();
    } else if (Node.isPropertyAccessExpression(objectExpr)) {
      // Nested: a.b.method() - get 'b'
      objectName = objectExpr.getName();
    }

    // Skip common non-function calls
    const skipPatterns = ['console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet'];
    if (skipPatterns.includes(objectName)) {
      return null;
    }

    // Try to resolve through imports (namespace or default import)
    if (fileImports && objectName) {
      const resolved = resolveCall(objectName, methodName, fileImports);
      if (resolved) {
        return {
          targetFunction: methodName,
          originalName: resolved.originalName !== methodName ? resolved.originalName : undefined,
          targetFile: resolved.sourceFile,
          line,
        };
      }
    }

    return {
      targetFunction: methodName,
      line,
    };
  }

  return null;
}

/**
 * Find all functions in the call chain leading to a target function
 * Returns functions that eventually call the target (directly or indirectly)
 */
export function findCallersOf(
  graph: CallGraph,
  targetFunctionName: string,
  maxDepth: number = 10
): Array<{ functionName: string; file: string; depth: number }> {
  const result: Array<{ functionName: string; file: string; depth: number }> = [];
  const visited = new Set<string>();

  function traverse(funcName: string, depth: number) {
    if (depth > maxDepth) return;

    const nodes = graph.byName.get(funcName) ?? [];
    for (const node of nodes) {
      const key = nodeKey(node);
      if (visited.has(key)) continue;
      visited.add(key);

      if (node.calledBy) {
        for (const caller of node.calledBy) {
          result.push({
            functionName: caller.callerFunction,
            file: caller.callerFile,
            depth,
          });
          traverse(caller.callerFunction, depth + 1);
        }
      }
    }
  }

  traverse(targetFunctionName, 1);
  return result;
}

/**
 * Find all functions called by a target function (directly or indirectly)
 */
export function findCalleesOf(
  graph: CallGraph,
  targetFunctionName: string,
  targetFile: string,
  maxDepth: number = 10
): Array<{ functionName: string; file?: string; depth: number; originalName?: string }> {
  const result: Array<{ functionName: string; file?: string; depth: number; originalName?: string }> = [];
  const visited = new Set<string>();

  function traverse(funcName: string, file: string | undefined, depth: number) {
    if (depth > maxDepth) return;

    const node = file
      ? (graph.byName.get(funcName) ?? []).find((n) => n.file === file)
      : graph.byName.get(funcName)?.[0];

    if (!node) {
      // Try original name lookup
      const byOriginal = graph.byName.get(funcName)?.[0];
      if (byOriginal) {
        traverse(funcName, byOriginal.file, depth);
      }
      return;
    }

    for (const call of node.calls) {
      const callKey = `${call.targetFile ?? ''}:${call.originalName ?? call.targetFunction}`;
      if (visited.has(callKey)) continue;
      visited.add(callKey);

      result.push({
        functionName: call.targetFunction,
        originalName: call.originalName,
        file: call.targetFile,
        depth,
      });

      // Continue traversal using original name if available
      const nextFunc = call.originalName ?? call.targetFunction;
      traverse(nextFunc, call.targetFile, depth + 1);
    }
  }

  traverse(targetFunctionName, targetFile, 1);
  return result;
}

/**
 * Check if any function in the call chain has an auth check
 */
export function hasAuthInCallChain(
  graph: CallGraph,
  targetFunctionName: string,
  authFunctions: Set<string>,
  maxDepth: number = 10
): { hasAuth: boolean; authLocation?: { functionName: string; file: string; depth: number } } {
  const callers = findCallersOf(graph, targetFunctionName, maxDepth);

  // Check if any caller is an auth function or contains auth
  for (const caller of callers) {
    if (authFunctions.has(caller.functionName)) {
      return {
        hasAuth: true,
        authLocation: caller,
      };
    }
  }

  // Also check the target function itself
  const targetNodes = graph.byName.get(targetFunctionName) ?? [];
  for (const node of targetNodes) {
    for (const call of node.calls) {
      const funcName = call.originalName ?? call.targetFunction;
      if (authFunctions.has(funcName)) {
        return {
          hasAuth: true,
          authLocation: {
            functionName: node.functionName,
            file: node.file,
            depth: 0,
          },
        };
      }
    }
  }

  return { hasAuth: false };
}
