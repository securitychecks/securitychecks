/**
 * Import Resolver
 *
 * Tracks import relationships to enable cross-file function resolution.
 * Handles:
 * - Named imports: import { foo, bar as baz } from './module'
 * - Default imports: import foo from './module'
 * - Namespace imports: import * as foo from './module'
 * - CommonJS: const { foo } = require('./module')
 * - Re-exports: export { foo } from './module'
 */

import { SourceFile, Node } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs';

// ============================================================================
// SCALABILITY LIMITS
// ============================================================================

/**
 * Maximum entries in import graph exports map
 */
const MAX_IMPORT_GRAPH_SIZE = parseInt(process.env['SCHECK_MAX_IMPORT_GRAPH'] || '500000', 10);

export interface ImportBinding {
  // The local name used in this file
  localName: string;
  // The original exported name from source module
  originalName: string;
  // The source module (relative or absolute path)
  sourceModule: string;
  // Resolved absolute file path (if resolvable)
  resolvedPath?: string;
  // Type of import
  type: 'named' | 'default' | 'namespace' | 'commonjs';
}

export interface FileImports {
  file: string;
  imports: ImportBinding[];
  // Quick lookup: localName -> ImportBinding
  byLocalName: Map<string, ImportBinding>;
  // Quick lookup: originalName -> ImportBinding[]
  byOriginalName: Map<string, ImportBinding[]>;
}

export interface ImportGraph {
  // file path -> FileImports
  files: Map<string, FileImports>;
  // exported function name -> file paths that export it
  exports: Map<string, string[]>;
}

/**
 * Extract all imports from a source file
 */
export function extractImports(
  sourceFile: SourceFile,
  targetPath: string
): FileImports {
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');
  const fileDir = path.dirname(filePath);

  const imports: ImportBinding[] = [];
  const byLocalName = new Map<string, ImportBinding>();
  const byOriginalName = new Map<string, ImportBinding[]>();

  // Process ES6 imports
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const resolvedPath = resolveModulePath(moduleSpecifier, fileDir, targetPath);

    // Default import: import foo from './module'
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport) {
      const binding: ImportBinding = {
        localName: defaultImport.getText(),
        originalName: 'default',
        sourceModule: moduleSpecifier,
        resolvedPath,
        type: 'default',
      };
      imports.push(binding);
      byLocalName.set(binding.localName, binding);
      addToMultiMap(byOriginalName, 'default', binding);
    }

    // Namespace import: import * as foo from './module'
    const namespaceImport = importDecl.getNamespaceImport();
    if (namespaceImport) {
      const binding: ImportBinding = {
        localName: namespaceImport.getText(),
        originalName: '*',
        sourceModule: moduleSpecifier,
        resolvedPath,
        type: 'namespace',
      };
      imports.push(binding);
      byLocalName.set(binding.localName, binding);
    }

    // Named imports: import { foo, bar as baz } from './module'
    const namedImports = importDecl.getNamedImports();
    for (const namedImport of namedImports) {
      const localName = namedImport.getName();
      const originalName = namedImport.getAliasNode()
        ? namedImport.getNameNode().getText()
        : localName;

      // Handle aliased imports: import { foo as bar }
      const actualLocalName = namedImport.getAliasNode()?.getText() ?? localName;

      const binding: ImportBinding = {
        localName: actualLocalName,
        originalName,
        sourceModule: moduleSpecifier,
        resolvedPath,
        type: 'named',
      };
      imports.push(binding);
      byLocalName.set(binding.localName, binding);
      addToMultiMap(byOriginalName, originalName, binding);
    }
  }

  // Process CommonJS requires: const { foo } = require('./module')
  sourceFile.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return;

    const initializer = node.getInitializer();
    if (!initializer || !Node.isCallExpression(initializer)) return;

    const expression = initializer.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'require') return;

    const args = initializer.getArguments();
    if (args.length === 0 || !Node.isStringLiteral(args[0]!)) return;

    const moduleSpecifier = (args[0] as any).getLiteralValue();
    const resolvedPath = resolveModulePath(moduleSpecifier, fileDir, targetPath);

    const nameNode = node.getNameNode();

    // Destructured require: const { foo, bar: baz } = require('./module')
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const propertyName = element.getPropertyNameNode()?.getText();
        const localName = element.getNameNode().getText();
        const originalName = propertyName ?? localName;

        const binding: ImportBinding = {
          localName,
          originalName,
          sourceModule: moduleSpecifier,
          resolvedPath,
          type: 'commonjs',
        };
        imports.push(binding);
        byLocalName.set(binding.localName, binding);
        addToMultiMap(byOriginalName, originalName, binding);
      }
    }

    // Simple require: const foo = require('./module')
    if (Node.isIdentifier(nameNode)) {
      const binding: ImportBinding = {
        localName: nameNode.getText(),
        originalName: 'default',
        sourceModule: moduleSpecifier,
        resolvedPath,
        type: 'commonjs',
      };
      imports.push(binding);
      byLocalName.set(binding.localName, binding);
    }
  });

  return {
    file: relativePath,
    imports,
    byLocalName,
    byOriginalName,
  };
}

/**
 * Extract all exports from a source file
 */
export function extractExports(
  sourceFile: SourceFile,
  targetPath: string
): Array<{ name: string; file: string }> {
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');
  const exports: Array<{ name: string; file: string }> = [];

  // Named exports: export function foo() {} or export const foo = ...
  for (const exportedDecl of sourceFile.getExportedDeclarations()) {
    const [name, _declarations] = exportedDecl;
    if (name !== 'default') {
      exports.push({ name, file: relativePath });
    }
  }

  // Default export
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (defaultExport) {
    exports.push({ name: 'default', file: relativePath });
  }

  return exports;
}

/**
 * Resolve a module specifier to an absolute path
 */
function resolveModulePath(
  moduleSpecifier: string,
  fromDir: string,
  targetPath: string
): string | undefined {
  // Skip node_modules
  if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
    return undefined;
  }

  // Resolve relative path
  const resolved = path.resolve(fromDir, moduleSpecifier);

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (!fs.existsSync(withExt)) continue;

    // Return relative to target path if possible
    if (withExt.startsWith(targetPath)) {
      return withExt.replace(targetPath + '/', '');
    }
    return withExt;
  }

  // Return as-is if couldn't resolve
  return resolved.replace(targetPath + '/', '');
}

/**
 * Helper to add to a multi-value map
 */
function addToMultiMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(value);
}

/**
 * Resolve a function call to its original name and source file
 *
 * Examples:
 *   notify() where import { sendEmail as notify } -> { originalName: 'sendEmail', file: 'email.ts' }
 *   email.send() where import * as email -> { originalName: 'send', file: 'email.ts' }
 */
export function resolveCall(
  localName: string,
  propertyAccess: string | undefined,
  fileImports: FileImports
): { originalName: string; sourceFile?: string } | null {
  const binding = fileImports.byLocalName.get(localName);

  if (!binding) {
    // Not an imported function, might be local
    return null;
  }

  // Namespace import: email.send() -> resolve 'send' from email module
  if (binding.type === 'namespace' && propertyAccess) {
    return {
      originalName: propertyAccess,
      sourceFile: binding.resolvedPath,
    };
  }

  // Named/default import: notify() -> sendEmail
  if (!propertyAccess) {
    return {
      originalName: binding.originalName === 'default' ? localName : binding.originalName,
      sourceFile: binding.resolvedPath,
    };
  }

  // Object property access on default import: service.method()
  if (binding.type === 'default' || binding.type === 'commonjs') {
    return {
      originalName: propertyAccess,
      sourceFile: binding.resolvedPath,
    };
  }

  return null;
}

/**
 * Build a complete import graph for the project
 */
export function buildImportGraph(
  sourceFiles: SourceFile[],
  targetPath: string
): ImportGraph {
  const files = new Map<string, FileImports>();
  const exports = new Map<string, string[]>();
  let totalExports = 0;
  let hitLimit = false;

  for (const sourceFile of sourceFiles) {
    // Scalability: check if we've hit the size limit
    if (totalExports >= MAX_IMPORT_GRAPH_SIZE) {
      if (!hitLimit) {
        console.warn(
          `[collector] Import graph size limit reached (${MAX_IMPORT_GRAPH_SIZE} exports). ` +
            `Stopping early. Set SCHECK_MAX_IMPORT_GRAPH to increase.`
        );
        hitLimit = true;
      }
      break;
    }

    // Extract imports
    const fileImports = extractImports(sourceFile, targetPath);
    files.set(fileImports.file, fileImports);

    // Extract exports
    const fileExports = extractExports(sourceFile, targetPath);
    for (const exp of fileExports) {
      if (totalExports >= MAX_IMPORT_GRAPH_SIZE) break;

      if (!exports.has(exp.name)) {
        exports.set(exp.name, []);
      }
      exports.get(exp.name)!.push(exp.file);
      totalExports++;
    }
  }

  return { files, exports };
}
