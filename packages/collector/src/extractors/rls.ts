/**
 * RLS (Row Level Security) Extractor
 *
 * Extracts RLS-related facts from codebases:
 * - Multi-tenant table patterns (organizationId, tenantId, etc.)
 * - RLS policy definitions in migrations
 * - Supabase RLS configurations
 * - Database queries without tenant filtering
 *
 * Used by AUTHZ.RLS.MULTI_TENANT and AUTHZ.TENANT.ISOLATION invariants.
 */

import { Project, SourceFile, Node } from 'ts-morph';
import { glob } from 'glob';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  ExtractorOptions,
  RLSPolicy,
  RLSArtifact,
  TenantPattern,
  DatabaseFramework,
} from '../types.js';
import { shouldSkipTestFile } from '../files/test-file.js';
import { collectFilePaths } from '../files/source-files.js';

// ============================================================================
// Tenant Column Patterns
// ============================================================================

const TENANT_COLUMN_PATTERNS: Array<{ pattern: RegExp; type: TenantPattern }> = [
  { pattern: /organizationId/i, type: 'organization' },
  { pattern: /organisation_?id/i, type: 'organization' },
  { pattern: /org_?id/i, type: 'organization' },
  { pattern: /tenantId/i, type: 'tenant' },
  { pattern: /tenant_?id/i, type: 'tenant' },
  { pattern: /teamId/i, type: 'team' },
  { pattern: /team_?id/i, type: 'team' },
  { pattern: /workspaceId/i, type: 'workspace' },
  { pattern: /workspace_?id/i, type: 'workspace' },
  { pattern: /accountId/i, type: 'account' },
  { pattern: /account_?id/i, type: 'account' },
  { pattern: /companyId/i, type: 'company' },
  { pattern: /company_?id/i, type: 'company' },
  // User-based isolation (common in single-tenant or user-scoped apps)
  { pattern: /userId/i, type: 'user' },
  { pattern: /user_?id/i, type: 'user' },
  { pattern: /ownerId/i, type: 'user' },
  { pattern: /owner_?id/i, type: 'user' },
  { pattern: /createdById/i, type: 'user' },
  { pattern: /authorId/i, type: 'user' },
];

// ============================================================================
// Main Extractor
// ============================================================================

export async function extractRLS(options: ExtractorOptions): Promise<RLSArtifact> {
  const { targetPath, config } = options;

  const artifact: RLSArtifact = {
    multiTenantTables: [],
    rlsPolicies: [],
    queries: [],
    framework: 'unknown',
    usesSupabase: false,
    hasRLSContextHelper: false,
  };

  // Find all source files
  const sourceFiles = await collectFilePaths({
    targetPath,
    config,
    patterns: config.include,
  });

  // Detect framework and Supabase usage
  artifact.framework = await detectFramework(targetPath, sourceFiles);
  artifact.usesSupabase = await detectSupabase(sourceFiles);

  // Find Prisma schema
  const prismaSchemaPath = await findPrismaSchema(targetPath);
  if (prismaSchemaPath) {
    artifact.framework = 'prisma';
    await extractPrismaMultiTenant(prismaSchemaPath, targetPath, artifact);
  }

  // Find SQL migrations for RLS policies
  const migrationFiles = await findMigrationFiles(targetPath);
  await extractSQLRLSPolicies(migrationFiles, targetPath, artifact);

  // Check for RLS context helper patterns
  artifact.hasRLSContextHelper = await detectRLSContextHelper(sourceFiles);

  // Extract database queries from TypeScript files
  const tsFiles = sourceFiles.filter((file) => {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return false;
    return !file.includes('node_modules');
  });
  await extractDatabaseQueries(tsFiles, targetPath, config, artifact);

  return artifact;
}

// ============================================================================
// Framework Detection
// ============================================================================

async function detectFramework(
  targetPath: string,
  sourceFiles: string[]
): Promise<DatabaseFramework> {
  // Check for Prisma
  const prismaPath = path.join(targetPath, 'prisma', 'schema.prisma');
  try {
    await fs.access(prismaPath);
    return 'prisma';
  } catch {
    // Not Prisma
  }

  // Check for Supabase
  for (const file of sourceFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      if (content.includes('@supabase/supabase-js') || content.includes('createClient')) {
        if (content.includes('supabase')) {
          return 'supabase';
        }
      }
      if (content.includes('drizzle-orm')) {
        return 'drizzle';
      }
      if (content.includes('typeorm')) {
        return 'typeorm';
      }
      if (content.includes('sequelize')) {
        return 'sequelize';
      }
    } catch {
      // Skip unreadable files
    }
  }

  return 'unknown';
}

async function detectSupabase(sourceFiles: string[]): Promise<boolean> {
  for (const file of sourceFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      if (
        content.includes('@supabase/supabase-js') ||
        content.includes('createClient') && content.includes('supabase')
      ) {
        return true;
      }
    } catch {
      // Skip unreadable files
    }
  }
  return false;
}

async function detectRLSContextHelper(sourceFiles: string[]): Promise<boolean> {
  const rlsPatterns = [
    /withRLSContext/i,
    /rlsContext/i,
    /setTenantContext/i,
    /SET\s+LOCAL\s+app\./i,
    /current_setting.*app\./i,
    /set.*tenant.*context/i,
  ];

  for (const file of sourceFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      for (const pattern of rlsPatterns) {
        if (pattern.test(content)) {
          return true;
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return false;
}

// ============================================================================
// Prisma Schema Extraction
// ============================================================================

async function findPrismaSchema(targetPath: string): Promise<string | null> {
  const commonPaths = [
    path.join(targetPath, 'prisma', 'schema.prisma'),
    path.join(targetPath, 'schema.prisma'),
    path.join(targetPath, 'packages', 'db', 'prisma', 'schema.prisma'),
    path.join(targetPath, 'apps', 'web', 'prisma', 'schema.prisma'),
  ];

  for (const p of commonPaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // Not found
    }
  }

  // Glob search as fallback
  const found = await glob('**/prisma/schema.prisma', {
    cwd: targetPath,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });

  return found[0] || null;
}

async function extractPrismaMultiTenant(
  schemaPath: string,
  targetPath: string,
  artifact: RLSArtifact
): Promise<void> {
  const content = await fs.readFile(schemaPath, 'utf-8');
  const relativePath = schemaPath.replace(targetPath + '/', '');
  const lines = content.split('\n');

  let currentModel: string | null = null;
  let modelStartLine = 0;
  let tenantColumn: string | null = null;
  let tenantPattern: TenantPattern = 'unknown';
  const relatedTables: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNum = i + 1;

    // Track model definitions
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      // Save previous model if it had tenant column
      if (currentModel && tenantColumn) {
        artifact.multiTenantTables.push({
          file: relativePath,
          line: modelStartLine,
          table: currentModel,
          tenantColumn,
          tenantPattern,
          hasRLSPolicy: false,
          hasQueryFiltering: false,
          relatedTables: relatedTables.length > 0 ? [...relatedTables] : undefined,
          framework: 'prisma',
        });
      }

      currentModel = modelMatch[1] ?? null;
      modelStartLine = lineNum;
      tenantColumn = null;
      tenantPattern = 'unknown';
      relatedTables.length = 0;
    }

    // Check for tenant columns
    if (currentModel) {
      for (const { pattern, type } of TENANT_COLUMN_PATTERNS) {
        const match = line.match(new RegExp(`(${pattern.source})\\s+String`, 'i'));
        if (match) {
          tenantColumn = match[1] ?? null;
          tenantPattern = type;
          break;
        }
      }

      // Track relationships to Organization/Tenant models
      const relationMatch = line.match(
        /(\w+)\s+(Organization|Tenant|Team|Workspace|Account|Company)\s+@relation/i
      );
      if (relationMatch) {
        relatedTables.push(relationMatch[2] ?? '');
      }
    }

    // End of model
    if (line.trim() === '}' && currentModel) {
      if (tenantColumn) {
        artifact.multiTenantTables.push({
          file: relativePath,
          line: modelStartLine,
          table: currentModel,
          tenantColumn,
          tenantPattern,
          hasRLSPolicy: false,
          hasQueryFiltering: false,
          relatedTables: relatedTables.length > 0 ? [...relatedTables] : undefined,
          framework: 'prisma',
        });
      }
      currentModel = null;
      tenantColumn = null;
      tenantPattern = 'unknown';
      relatedTables.length = 0;
    }
  }
}

// ============================================================================
// SQL Migration Extraction
// ============================================================================

async function findMigrationFiles(targetPath: string): Promise<string[]> {
  const patterns = [
    '**/migrations/**/*.sql',
    '**/prisma/migrations/**/*.sql',
    '**/supabase/migrations/**/*.sql',
    '**/db/migrations/**/*.sql',
  ];

  const files: string[] = [];
  for (const pattern of patterns) {
    const found = await glob(pattern, {
      cwd: targetPath,
      absolute: true,
      ignore: ['**/node_modules/**'],
    });
    files.push(...found);
  }

  return [...new Set(files)]; // Deduplicate
}

async function extractSQLRLSPolicies(
  files: string[],
  targetPath: string,
  artifact: RLSArtifact
): Promise<void> {
  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const relativePath = filePath.replace(targetPath + '/', '');

      // Look for ENABLE ROW LEVEL SECURITY
      const enableRLSRegex =
        /ALTER\s+TABLE\s+["']?(\w+)["']?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
      let match;
      while ((match = enableRLSRegex.exec(content)) !== null) {
        const table = match[1] ?? '';
        // Mark corresponding table as having RLS
        const tableEntry = artifact.multiTenantTables.find(
          (t) => t.table.toLowerCase() === table.toLowerCase()
        );
        if (tableEntry) {
          tableEntry.hasRLSPolicy = true;
        }
      }

      // Look for CREATE POLICY statements
      const policyRegex =
        /CREATE\s+POLICY\s+["']?(\w+)["']?\s+ON\s+["']?(\w+)["']?([^;]+)/gi;
      while ((match = policyRegex.exec(content)) !== null) {
        const policyName = match[1];
        const table = match[2];
        const policyBody = match[3] ?? '';
        const lineNum = content.slice(0, match.index).split('\n').length;

        const hasUsing = /USING\s*\(/i.test(policyBody);
        const hasWithCheck = /WITH\s+CHECK\s*\(/i.test(policyBody);
        const usesSessionContext =
          /current_setting\s*\(/i.test(policyBody) ||
          /auth\.uid\(\)/i.test(policyBody) ||
          /auth\.jwt\(\)/i.test(policyBody);

        // Extract operations
        const operations: RLSPolicy['operations'] = [];
        if (/FOR\s+ALL/i.test(policyBody)) {
          operations.push('ALL');
        } else {
          if (/FOR\s+SELECT/i.test(policyBody)) operations.push('SELECT');
          if (/FOR\s+INSERT/i.test(policyBody)) operations.push('INSERT');
          if (/FOR\s+UPDATE/i.test(policyBody)) operations.push('UPDATE');
          if (/FOR\s+DELETE/i.test(policyBody)) operations.push('DELETE');
        }

        // Extract tenant column from policy
        let tenantColumn: string | undefined;
        for (const { pattern } of TENANT_COLUMN_PATTERNS) {
          if (pattern.test(policyBody)) {
            const colMatch = policyBody.match(pattern);
            if (colMatch) {
              tenantColumn = colMatch[0];
              break;
            }
          }
        }

        artifact.rlsPolicies.push({
          file: relativePath,
          line: lineNum,
          table: table ?? '',
          policyName,
          policyType: hasUsing && hasWithCheck ? 'both' : hasUsing ? 'using' : 'with_check',
          tenantColumn,
          usesSessionContext,
          sessionContextPattern: extractSessionPattern(policyBody),
          operations: operations.length > 0 ? operations : undefined,
        });

        // Mark corresponding table as having RLS
        const tableEntry = artifact.multiTenantTables.find(
          (t) => t.table.toLowerCase() === (table ?? '').toLowerCase()
        );
        if (tableEntry) {
          tableEntry.hasRLSPolicy = true;
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
}

function extractSessionPattern(policyBody: string): string | undefined {
  // Match current_setting patterns
  const settingMatch = policyBody.match(/current_setting\s*\(\s*['"]([^'"]+)['"]/i);
  if (settingMatch) return `current_setting('${settingMatch[1]}')`;

  // Match Supabase auth patterns
  if (/auth\.uid\(\)/i.test(policyBody)) return 'auth.uid()';
  if (/auth\.jwt\(\)/i.test(policyBody)) return 'auth.jwt()';

  return undefined;
}

// ============================================================================
// Database Query Extraction
// ============================================================================

async function extractDatabaseQueries(
  files: string[],
  targetPath: string,
  config: ExtractorOptions['config'],
  artifact: RLSArtifact
): Promise<void> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, checkJs: false },
  });

  for (const file of files) {
    try {
      project.addSourceFileAtPath(file);
    } catch {
      // Skip unparseable files
    }
  }

  for (const sourceFile of project.getSourceFiles()) {
    const relativePath = sourceFile.getFilePath().replace(targetPath + '/', '');

    if (shouldSkipTestFile(sourceFile, relativePath, config)) {
      continue;
    }

    extractPrismaQueries(sourceFile, relativePath, artifact);
  }

  // Mark tables that have filtering in queries
  for (const query of artifact.queries) {
    if (query.hasTenantFilter) {
      const table = artifact.multiTenantTables.find(
        (t) => t.table.toLowerCase() === query.table.toLowerCase()
      );
      if (table) {
        table.hasQueryFiltering = true;
      }
    }
  }
}

function extractPrismaQueries(
  sourceFile: SourceFile,
  file: string,
  artifact: RLSArtifact
): void {
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const text = node.getText();

    // Match: prisma.model.operation() or db.model.operation() or tx.model.operation()
    const prismaMatch = text.match(
      /(prisma|db|tx|client)\s*\.\s*(\w+)\s*\.\s*(findMany|findUnique|findFirst|create|createMany|update|updateMany|delete|deleteMany|upsert|aggregate|groupBy|count)/i
    );

    if (prismaMatch) {
      const table = prismaMatch[2] ?? '';
      const operation = prismaMatch[3] ?? '';
      const lineNum = node.getStartLineNumber();

      // Skip if table name looks like a utility (not a model)
      if (['$', '_', 'raw', 'queryRaw', 'executeRaw'].some((s) => table.startsWith(s))) {
        return;
      }

      // Check if where clause includes tenant filtering OR primary key filtering
      // Primary key filtering (where: { id: ... }) is valid isolation because:
      // 1. The caller must have obtained the ID through proper authorization
      // 2. It inherently limits the query to a single record
      const hasTenantColumnFilter = TENANT_COLUMN_PATTERNS.some((p) => p.pattern.test(text));
      const hasPrimaryKeyFilter = /where\s*:\s*\{\s*id\s*[,:}]/i.test(text) ||
                                   /where\s*\(\s*\{\s*id\s*[,:}]/i.test(text) ||
                                   /\.eq\s*\(\s*['"`]id['"`]/i.test(text);
      const hasTenantFilter = hasTenantColumnFilter || hasPrimaryKeyFilter;

      // Get containing function
      let containingFunction: string | undefined;
      let current = node.getParent();
      while (current) {
        if (Node.isFunctionDeclaration(current)) {
          containingFunction = current.getName();
          break;
        }
        if (Node.isMethodDeclaration(current)) {
          containingFunction = current.getName();
          break;
        }
        if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
          const parent = current.getParent();
          if (Node.isVariableDeclaration(parent)) {
            containingFunction = parent.getName();
            break;
          }
        }
        current = current.getParent();
      }

      // Extract tenant filter expression if present
      let tenantFilterExpression: string | undefined;
      if (hasTenantFilter) {
        for (const { pattern } of TENANT_COLUMN_PATTERNS) {
          const match = text.match(new RegExp(`${pattern.source}\\s*[:=]\\s*[^,}]+`, 'i'));
          if (match) {
            tenantFilterExpression = match[0];
            break;
          }
        }
      }

      artifact.queries.push({
        file,
        line: lineNum,
        table,
        operation: mapOperation(operation),
        hasTenantFilter,
        tenantFilterExpression,
        containingFunction,
        framework: 'prisma',
      });
    }

    // Match Supabase queries: supabase.from('table').select()
    const supabaseMatch = text.match(
      /supabase\s*\.from\s*\(\s*['"`](\w+)['"`]\s*\)\s*\.(\w+)/i
    );

    if (supabaseMatch) {
      const table = supabaseMatch[1] ?? '';
      const operation = supabaseMatch[2] ?? '';
      const lineNum = node.getStartLineNumber();

      // Check for tenant filtering OR primary key filtering
      const hasTenantColumnFilter = TENANT_COLUMN_PATTERNS.some((p) => p.pattern.test(text));
      const hasPrimaryKeyFilter = /\.eq\s*\(\s*['"`]id['"`]/i.test(text) ||
                                   /\.match\s*\(\s*\{\s*id\s*:/i.test(text);
      const hasTenantFilter = hasTenantColumnFilter || hasPrimaryKeyFilter;

      artifact.queries.push({
        file,
        line: lineNum,
        table,
        operation: mapOperation(operation),
        hasTenantFilter,
        framework: 'supabase',
      });
    }
  });
}

function mapOperation(op: string): 'select' | 'insert' | 'update' | 'delete' {
  const lower = op.toLowerCase();
  if (lower.includes('find') || lower === 'select' || lower === 'aggregate' || lower === 'count' || lower === 'groupby') {
    return 'select';
  }
  if (lower === 'create' || lower === 'createmany' || lower === 'insert' || lower === 'upsert') {
    return 'insert';
  }
  if (lower.includes('update')) {
    return 'update';
  }
  if (lower.includes('delete')) {
    return 'delete';
  }
  return 'select';
}
