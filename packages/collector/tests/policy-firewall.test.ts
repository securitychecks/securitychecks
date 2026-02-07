/**
 * Policy Firewall Test
 *
 * Ensures the collector remains a pure fact-extraction layer.
 * The collector must NEVER contain policy, interpretation, or enforcement logic.
 *
 * "The collector emits facts. Products interpret facts. Policy never lives in the collector."
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const COLLECTOR_SRC = join(__dirname, '../src');

// Files that are allowed to exist during transition but should be removed
// NOTE: invariants.ts STAYS in collector - invariant definitions are data, not policy
const DEPRECATED_FILES = [
  'checkers/', // Checkers have been moved to @securitychecks/cli
];

// Forbidden imports - collector should never import these
const FORBIDDEN_IMPORTS = [
  '@securitychecks/cli',
  'packages/cli',
  '../cli',
  './cli',
];

// Forbidden terms in artifact types - these indicate policy leakage
const FORBIDDEN_ARTIFACT_FIELDS = [
  'severity',
  'priority',
  'P0',
  'P1',
  'P2',
  'finding',
  'violation',
  'recommendation',
  'fix',
  'remediation',
  'fail',
  'pass',
  'waiver',
  'baseline',
];

// Allowed terms that might look like policy but are facts
const ALLOWED_EXCEPTIONS = [
  'hasIdempotencyCheck', // This is a fact: does the code have this pattern?
  'containsSideEffects', // This is a fact: does the transaction contain side effects?
  'isPermissive', // This is a fact about test assertions
];

function getAllFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      getAllFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('Collector Policy Firewall', () => {
  describe('No forbidden imports', () => {
    const files = getAllFiles(COLLECTOR_SRC);

    for (const file of files) {
      const relativePath = relative(COLLECTOR_SRC, file);

      // Skip deprecated files (they're being removed)
      if (DEPRECATED_FILES.some((dep) => relativePath.startsWith(dep))) {
        continue;
      }

      it(`${relativePath} should not import policy modules`, () => {
        const content = readFileSync(file, 'utf-8');

        for (const forbidden of FORBIDDEN_IMPORTS) {
          expect(content).not.toContain(`from '${forbidden}`);
          expect(content).not.toContain(`from "${forbidden}`);
          expect(content).not.toContain(`require('${forbidden}`);
          expect(content).not.toContain(`require("${forbidden}`);
        }
      });
    }
  });

  describe('Artifact types contain only facts', () => {
    it('CollectorArtifact should not have policy-related fields', () => {
      const typesFile = readFileSync(join(COLLECTOR_SRC, 'types.ts'), 'utf-8');

      // Extract the CollectorArtifact interface
      const artifactMatch = typesFile.match(
        /interface CollectorArtifact \{[\s\S]*?\n\}/
      );

      if (!artifactMatch) {
        throw new Error('Could not find CollectorArtifact interface');
      }

      const artifactDef = artifactMatch[0];

      for (const forbidden of FORBIDDEN_ARTIFACT_FIELDS) {
        // Check if the term appears and is not in an exception
        if (artifactDef.toLowerCase().includes(forbidden.toLowerCase())) {
          const isException = ALLOWED_EXCEPTIONS.some((exc) =>
            artifactDef.includes(exc)
          );

          if (!isException) {
            throw new Error(
              `CollectorArtifact contains forbidden field/term: "${forbidden}"\n` +
                `This suggests policy leakage. Artifacts should only contain facts.`
            );
          }
        }
      }
    });

    it('Extractor output types should not have policy-related fields', () => {
      const typesFile = readFileSync(join(COLLECTOR_SRC, 'types.ts'), 'utf-8');

      // Check all Entry/Call/Handler interfaces (extractor outputs)
      const extractorTypes = [
        'ServiceEntry',
        'AuthzCall',
        'CacheOperation',
        'TransactionScope',
        'WebhookHandler',
        'JobHandler',
        'TestEntry',
      ];

      for (const typeName of extractorTypes) {
        const pattern = new RegExp(
          `interface ${typeName} \\{[\\s\\S]*?\\n\\}`,
          'g'
        );
        const match = typesFile.match(pattern);

        if (!match) continue;

        const typeDef = match[0];

        for (const forbidden of FORBIDDEN_ARTIFACT_FIELDS) {
          if (
            typeDef.toLowerCase().includes(forbidden.toLowerCase()) &&
            !ALLOWED_EXCEPTIONS.some((exc) => typeDef.includes(exc))
          ) {
            throw new Error(
              `${typeName} contains forbidden field/term: "${forbidden}"\n` +
                `Extractor outputs should only contain facts, not policy.`
            );
          }
        }
      }
    });
  });

  describe('No severity/priority in extractor code', () => {
    const extractorDir = join(COLLECTOR_SRC, 'extractors');

    if (statSync(extractorDir).isDirectory()) {
      const files = getAllFiles(extractorDir);

      for (const file of files) {
        const relativePath = relative(COLLECTOR_SRC, file);

        it(`${relativePath} should not assign severity or priority`, () => {
          const content = readFileSync(file, 'utf-8');

          // These patterns indicate policy logic in extractors
          const policyPatterns = [
            /severity\s*[:=]\s*['"]P[012]['"]/,
            /priority\s*[:=]/,
            /\.severity\s*=/,
            /finding\s*[:=]/,
            /violation\s*[:=]/,
          ];

          for (const pattern of policyPatterns) {
            expect(content).not.toMatch(pattern);
          }
        });
      }
    }
  });

  describe('Deprecated code tracking', () => {
    it('should list deprecated files that need removal', () => {
      const deprecatedPaths: string[] = [];

      for (const dep of DEPRECATED_FILES) {
        const fullPath = join(COLLECTOR_SRC, dep);
        try {
          statSync(fullPath);
          deprecatedPaths.push(dep);
        } catch {
          // File doesn't exist, good
        }
      }

      if (deprecatedPaths.length > 0) {
        console.warn(
          '\n⚠️  DEPRECATED: The following should be moved to @securitychecks/cli:\n' +
            deprecatedPaths.map((p) => `   - ${p}`).join('\n') +
            '\n'
        );
      }

      // This test passes but warns - remove when cleanup is complete
      expect(true).toBe(true);
    });
  });
});
