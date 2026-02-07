/**
 * Init command - initialize scheck in a project
 */

import { writeFile, mkdir, chmod } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { resolveTargetPath } from '@securitychecks/collector';

interface InitOptions {
  path?: string;
  hooks?: boolean;
}

const DEFAULT_CONFIG = `# SecurityChecks Configuration
# Catch what Copilot misses — Architectural security for AI-generated code
# https://securitychecks.ai/docs/config

version: "1.0"

# Paths to scan for source files
include:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "lib/**/*.ts"
  - "app/**/*.ts"
  - "app/**/*.tsx"

# Paths to exclude
exclude:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/build/**"
  - "**/.next/**"
  - "**/coverage/**"
  - "**/*.d.ts"

# Test file patterns
testPatterns:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
  - "**/tests/**/*.ts"
  - "**/__tests__/**/*.ts"

# Service file patterns (where authz should be enforced)
servicePatterns:
  - "**/services/**/*.ts"
  - "**/service/**/*.ts"
  - "**/lib/**/*.ts"
  - "**/server/**/*.ts"

# Uncomment to disable specific invariants
# disabledInvariants:
#   - "TESTS.NO_FALSE_CONFIDENCE"

# Uncomment to only run specific invariants
# enabledInvariants:
#   - "AUTHZ.SERVICE_LAYER.ENFORCED"
`;

const PRE_COMMIT_HOOK = `#!/bin/sh
# SecurityChecks pre-commit hook
# https://securitychecks.ai/docs/hooks
#
# This hook runs scheck on changed files before each commit.
# To skip this check for a single commit, use: git commit --no-verify

# Check if scheck is available
if ! command -v scheck &> /dev/null && ! npx scheck --version &> /dev/null 2>&1; then
  echo "Warning: scheck not found. Install with: npm install -g @securitychecks/cli"
  echo "Skipping security checks..."
  exit 0
fi

echo "Running SecurityChecks on staged files..."

# Run scheck on changed files only
# --changed: only check files that differ from HEAD
# --ci: fail on new violations
if command -v scheck &> /dev/null; then
  scheck run --changed --ci
else
  npx scheck run --changed --ci
fi

exit_code=$?

if [ $exit_code -ne 0 ]; then
  echo ""
  echo "SecurityChecks found issues. Please fix them before committing."
  echo "To skip this check once: git commit --no-verify"
  echo ""
fi

exit $exit_code
`;

const GITHUB_ACTION = `name: SecurityChecks

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  scheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run SecurityChecks
        run: npx -y -p @securitychecks/cli scheck run --ci
`;

/**
 * Install the pre-commit hook in the git repository
 */
async function installPreCommitHook(targetPath: string): Promise<void> {
  const gitDir = join(targetPath, '.git');

  // Check if this is a git repository
  if (!existsSync(gitDir)) {
    console.log(pc.yellow('⚠') + ' Not a git repository, skipping pre-commit hook');
    return;
  }

  const hooksDir = join(gitDir, 'hooks');
  const hookPath = join(hooksDir, 'pre-commit');

  // Create hooks directory if it doesn't exist
  if (!existsSync(hooksDir)) {
    await mkdir(hooksDir, { recursive: true });
  }

  // Check if pre-commit hook already exists
  if (existsSync(hookPath)) {
    // Read existing hook to see if it's ours or something else
    const existingHook = await import('fs').then((fs) =>
      fs.promises.readFile(hookPath, 'utf-8')
    );

    if (existingHook.includes('SecurityChecks pre-commit hook')) {
      console.log(pc.yellow('⚠') + ' Pre-commit hook already installed');
      return;
    }

    // Another hook exists - append our check
    console.log(pc.yellow('⚠') + ' Existing pre-commit hook found');
    console.log(pc.dim('  To integrate SecurityChecks, add this to your hook:'));
    console.log(pc.cyan('  scheck run --changed --ci'));
    return;
  }

  // Install fresh hook
  await writeFile(hookPath, PRE_COMMIT_HOOK);
  await chmod(hookPath, 0o755); // Make executable
  console.log(pc.green('✓') + ' Installed pre-commit hook');
}

export async function initCommand(options: InitOptions): Promise<void> {
  const targetPath = resolveTargetPath(options.path);

  console.log(pc.bold('\n🔧 Initializing SecurityChecks for your project\n'));

  try {
    // Create .scheck directory
    const scheckDir = join(targetPath, '.scheck');
    if (!existsSync(scheckDir)) {
      await mkdir(scheckDir, { recursive: true });
      console.log(pc.green('✓') + ' Created .scheck directory');
    }

    // Create config file
    const configPath = join(scheckDir, 'config.yaml');
    if (!existsSync(configPath)) {
      await writeFile(configPath, DEFAULT_CONFIG);
      console.log(pc.green('✓') + ' Created .scheck/config.yaml');
    } else {
      console.log(pc.yellow('⚠') + ' Config already exists, skipping');
    }

    // Create baseline file
    const baselinePath = join(scheckDir, 'baseline.json');
    if (!existsSync(baselinePath)) {
      const baseline = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entries: [],
      };
      await writeFile(baselinePath, JSON.stringify(baseline, null, 2));
      console.log(pc.green('✓') + ' Created .scheck/baseline.json');
    } else {
      console.log(pc.yellow('⚠') + ' Baseline already exists, skipping');
    }

    // Create GitHub Action
    const workflowDir = join(targetPath, '.github', 'workflows');
    const workflowPath = join(workflowDir, 'scheck.yml');
    if (!existsSync(workflowPath)) {
      await mkdir(workflowDir, { recursive: true });
      await writeFile(workflowPath, GITHUB_ACTION);
      console.log(pc.green('✓') + ' Created .github/workflows/scheck.yml');
    } else {
      console.log(pc.yellow('⚠') + ' GitHub Action already exists, skipping');
    }

    // Install pre-commit hook if requested
    if (options.hooks) {
      await installPreCommitHook(targetPath);
    }

    // Add to .gitignore if needed
    const gitignorePath = join(targetPath, '.gitignore');
    if (existsSync(gitignorePath)) {
      const gitignore = await import('fs').then((fs) =>
        fs.promises.readFile(gitignorePath, 'utf-8')
      );
      if (!gitignore.includes('.scheck/cache')) {
        await import('fs').then((fs) =>
          fs.promises.appendFile(gitignorePath, '\n# SecurityChecks\n.scheck/cache/\n')
        );
        console.log(pc.green('✓') + ' Updated .gitignore');
      }
    }

    console.log('');
    console.log(pc.green('✓ SecurityChecks is ready.'));
    console.log(pc.dim('  Catch what Copilot misses in your codebase.\n'));
    console.log(pc.bold('Next steps:'));
    console.log('');
    console.log('  1. Review the config at .scheck/config.yaml');
    console.log('  2. Run your first scan:');
    console.log(pc.cyan('     scheck run'));
    console.log('');
    console.log('  3. Fix any P0/P1 violations or add waivers');
    console.log('  4. Commit the .scheck directory');
    console.log('');
    console.log(pc.dim('Learn more: https://securitychecks.ai/docs'));
    console.log('');
  } catch (error) {
    console.error(pc.red('\nError initializing:'), error);
    process.exit(1);
  }
}
