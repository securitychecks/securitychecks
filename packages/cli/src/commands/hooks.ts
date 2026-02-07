/**
 * Hooks command - manage git hooks for SecurityChecks
 */

import { writeFile, mkdir, chmod, unlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { resolveTargetPath } from '@securitychecks/collector';

interface HooksOptions {
  path?: string;
  install?: boolean;
  uninstall?: boolean;
  show?: boolean;
}

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

export async function hooksCommand(options: HooksOptions): Promise<void> {
  const targetPath = resolveTargetPath(options.path);
  const gitDir = join(targetPath, '.git');

  // Check if this is a git repository
  if (!existsSync(gitDir)) {
    console.error(pc.red('Error:') + ' Not a git repository');
    process.exit(1);
  }

  const hooksDir = join(gitDir, 'hooks');
  const hookPath = join(hooksDir, 'pre-commit');

  // Default to --show if no action specified
  if (!options.install && !options.uninstall) {
    options.show = true;
  }

  if (options.show) {
    console.log(pc.bold('\nSecurityChecks Git Hooks\n'));

    if (existsSync(hookPath)) {
      const hookContent = await readFile(hookPath, 'utf-8');
      if (hookContent.includes('SecurityChecks pre-commit hook')) {
        console.log(pc.green('✓') + ' Pre-commit hook is installed');
        console.log(pc.dim(`  Location: ${hookPath}`));
      } else {
        console.log(pc.yellow('⚠') + ' Pre-commit hook exists but is not SecurityChecks');
        console.log(pc.dim('  Use --install to add SecurityChecks to your workflow'));
      }
    } else {
      console.log(pc.dim('○') + ' Pre-commit hook is not installed');
      console.log(pc.dim('  Use --install to install it'));
    }
    console.log('');
    return;
  }

  if (options.install) {
    // Create hooks directory if it doesn't exist
    if (!existsSync(hooksDir)) {
      await mkdir(hooksDir, { recursive: true });
    }

    // Check if hook already exists
    if (existsSync(hookPath)) {
      const existingHook = await readFile(hookPath, 'utf-8');

      if (existingHook.includes('SecurityChecks pre-commit hook')) {
        console.log(pc.yellow('⚠') + ' Pre-commit hook already installed');
        return;
      }

      // Another hook exists
      console.log(pc.yellow('⚠') + ' Existing pre-commit hook found');
      console.log(pc.dim('  To manually integrate, add this to your hook:'));
      console.log(pc.cyan('    scheck run --changed --ci'));
      console.log('');
      console.log(pc.dim('  Or use --uninstall first to replace the existing hook'));
      return;
    }

    // Install fresh hook
    await writeFile(hookPath, PRE_COMMIT_HOOK);
    await chmod(hookPath, 0o755);
    console.log(pc.green('✓') + ' Installed pre-commit hook');
    console.log(pc.dim('  SecurityChecks will run on staged files before each commit'));
    console.log(pc.dim('  To skip: git commit --no-verify'));
    return;
  }

  if (options.uninstall) {
    if (!existsSync(hookPath)) {
      console.log(pc.yellow('⚠') + ' No pre-commit hook found');
      return;
    }

    const hookContent = await readFile(hookPath, 'utf-8');
    if (!hookContent.includes('SecurityChecks pre-commit hook')) {
      console.log(pc.yellow('⚠') + ' Pre-commit hook is not a SecurityChecks hook');
      console.log(pc.dim('  Not removing to avoid breaking your existing hook'));
      return;
    }

    await unlink(hookPath);
    console.log(pc.green('✓') + ' Uninstalled pre-commit hook');
    return;
  }
}
