#!/usr/bin/env npx tsx
/**
 * Generate JSON Schema from CollectorArtifact TypeScript type
 *
 * This creates a stable contract for consumers and enables validation.
 * Run with: pnpm generate:schema
 */

import * as TJS from 'typescript-json-schema';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesPath = join(__dirname, '../src/types.ts');
const outputPath = join(__dirname, '../dist/collector-artifact.schema.json');

// Schema settings
const settings: TJS.PartialArgs = {
  required: true,
  noExtraProps: false, // Allow extra properties for forward compatibility
  strictNullChecks: true,
  ref: true,
  titles: true,
};

const compilerOptions: TJS.CompilerOptions = {
  target: 99, // ESNext
  module: 99, // ESNext
  moduleResolution: 100, // NodeNext
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
};

async function generateSchema() {
  console.log('Generating JSON Schema from CollectorArtifact...');

  const program = TJS.getProgramFromFiles([typesPath], compilerOptions);
  const schema = TJS.generateSchema(program, 'CollectorArtifact', settings);

  if (!schema) {
    console.error('Failed to generate schema');
    process.exit(1);
  }

  // Add metadata
  const finalSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://securitychecks.ai/schemas/collector-artifact.json',
    title: 'CollectorArtifact',
    description:
      'Output schema for SecurityChecks Collector (scc). ' +
      'Contains facts extracted from a codebase. No policy, no interpretation.',
    ...schema,
  };

  writeFileSync(outputPath, JSON.stringify(finalSchema, null, 2));
  console.log(`Schema written to: ${outputPath}`);
}

generateSchema().catch(console.error);
