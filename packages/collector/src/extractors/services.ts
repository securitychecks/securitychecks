/**
 * Service Extractor
 *
 * Extracts service entries from the codebase - functions that should have
 * authorization checks because they access tenant/user data.
 */

import { SourceFile, Node, VariableDeclaration } from 'ts-morph';
import type { ServiceEntry, ExtractorOptions } from '../types.js';
import { loadSourceFiles } from '../files/source-files.js';

// Files that should NOT be considered services (2026-01-09 accuracy fix)
// These are frontend/client code where auth is handled by the backend API
const NON_SERVICE_FILE_PATTERNS = [
  // Frontend frameworks and patterns
  /\/admin-x-/i,              // Ghost admin framework
  /\/design-system\//i,       // Design system components
  /\/components\//i,          // React components
  /\/ui\//i,                  // UI components
  /\/hooks\//i,               // React hooks
  /\/stores?\//i,             // State stores
  /\.client\.[tj]sx?$/i,      // Client-side files
  /\/client\//i,              // Client directory
  /\/frontend\//i,            // Frontend directory
  // Frontend API patterns (calls backend APIs, not backend services)
  /\/utils\/api\//i,          // API utility functions
  /createMutation|createQuery/i, // React Query patterns
  /use[A-Z][a-zA-Z]*\s*=/,    // React hooks (useFoo =)
  // Schema/type definitions (not executable services)
  /\.schema\.[tj]s$/i,        // Schema files (foo.schema.ts)
  /Schema\.[tj]s$/,           // Schema files PascalCase (FooSchema.ts)
  /\/schemas?\//i,            // Schema directories
  /\.types?\.[tj]s$/i,        // Type definition files
  /\/types?\//i,              // Type directories
  /\.dto\.[tj]s$/i,           // DTO files (Data Transfer Objects)
  /\/dtos?\//i,               // DTO directories
  // Model/DAO layer (intentionally auth-free, called from protected services)
  /\/models?\//i,             // Model directories
  /\/repositories?\//i,       // Repository directories
  /\/dao\//i,                 // DAO directories
  /\.model\.[tj]s$/i,         // Model files
  /\.repository\.[tj]s$/i,    // Repository files
  /\.entity\.[tj]s$/i,        // TypeORM entity files
  /\/entities?\//i,           // Entity directories
];

/**
 * Check if a file looks like a frontend/client file that should be excluded
 */
function isFrontendFile(filePath: string, fileText: string): boolean {
  // Check path patterns
  if (NON_SERVICE_FILE_PATTERNS.some((p) => p.test(filePath))) {
    return true;
  }

  // Check for React patterns in code
  const reactPatterns = [
    /^import.*from\s+['"]react['"]/m,        // React import
    /^import.*from\s+['"]@tanstack\/react-query['"]/m, // React Query
    /^export\s+const\s+use[A-Z]/m,           // React hooks export
    /createMutation\s*[<(]/,                  // createMutation usage
    /createQuery\s*[<(]/,                     // createQuery usage
  ];

  return reactPatterns.some((p) => p.test(fileText));
}

export async function extractServices(options: ExtractorOptions): Promise<ServiceEntry[]> {
  const { targetPath, config } = options;
  const services: ServiceEntry[] = [];

  const sourceFiles = await loadSourceFiles({
    targetPath,
    config,
    patterns: config.servicePatterns,
  });

  if (sourceFiles.length === 0) {
    return services;
  }

  // Extract service entries from each file
  for (const sourceFile of sourceFiles) {
    const fileServices = extractServicesFromFile(sourceFile, targetPath);
    services.push(...fileServices);
  }

  return services;
}

function extractServicesFromFile(sourceFile: SourceFile, targetPath: string): ServiceEntry[] {
  const services: ServiceEntry[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = filePath.replace(targetPath + '/', '');
  const fileText = sourceFile.getFullText();

  // Skip frontend/client files (2026-01-09 accuracy fix)
  if (isFrontendFile(relativePath, fileText)) {
    return services;
  }

  // Get all exported functions
  const exportedFunctions: string[] = [];

  // Check for named exports of functions
  sourceFile.getExportedDeclarations().forEach((declarations, name) => {
    for (const decl of declarations) {
      if (
        Node.isFunctionDeclaration(decl) ||
        Node.isArrowFunction(decl) ||
        Node.isFunctionExpression(decl) ||
        (Node.isVariableDeclaration(decl) && hasCallableInitializer(decl))
      ) {
        exportedFunctions.push(name);
      }
      // Extract methods from exported classes
      if (Node.isClassDeclaration(decl)) {
        for (const method of decl.getMethods()) {
          if (!method.getName().startsWith('_')) {
            exportedFunctions.push(method.getName());
          }
        }
      }
    }
  });

  // If this file has exported functions, it's a service
  if (exportedFunctions.length > 0) {
    services.push({
      file: relativePath,
      name: getServiceName(relativePath),
      exportedFunctions,
      line: 1, // File-level entry
    });
  }

  return services;
}

function hasCallableInitializer(decl: VariableDeclaration): boolean {
  const initializer = decl.getInitializer();
  if (!initializer) return false;

  return (
    Node.isArrowFunction(initializer) ||
    Node.isFunctionExpression(initializer) ||
    Node.isCallExpression(initializer) // For wrapped functions like `createService(...)`
  );
}

function getServiceName(filePath: string): string {
  // Extract service name from file path
  // e.g., "services/membership.ts" -> "membership"
  // e.g., "lib/billing/subscription.ts" -> "billing/subscription"

  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1]?.replace(/\.(ts|tsx|js|jsx)$/, '') ?? 'unknown';

  // If it's an index file, use parent directory name
  if (fileName === 'index') {
    return parts[parts.length - 2] ?? 'unknown';
  }

  // Skip common prefixes like 'services/', 'lib/', 'server/'
  const skipPrefixes = ['services', 'service', 'lib', 'server', 'api', 'src'];
  let startIndex = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    if (skipPrefixes.includes(parts[i]!)) {
      startIndex = i + 1;
    } else {
      break;
    }
  }

  const relevantParts = parts.slice(startIndex, -1);
  if (relevantParts.length > 0) {
    return [...relevantParts, fileName].join('/');
  }

  return fileName;
}
