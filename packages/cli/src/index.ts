#!/usr/bin/env node

/**
 * SecurityChecks CLI
 *
 * Enforce backend invariants in your codebase.
 * https://securitychecks.ai
 */

import { Command } from 'commander';
import { runCommand } from './commands/run.js';
import { explainCommand } from './commands/explain.js';
import { initCommand } from './commands/init.js';
import { baselineCommand } from './commands/baseline.js';
import { waiverCommand, waiveCommand } from './commands/waiver.js';
import { loginCommand, logoutCommand } from './commands/login.js';
import { configCommand } from './commands/config.js';
import { syncCommand } from './commands/sync.js';
import { hooksCommand } from './commands/hooks.js';
import { feedbackCommand } from './commands/feedback.js';
import { logger } from './lib/logger.js';

// Version injected at build time via tsup define
const version = process.env['CLI_VERSION'] ?? '0.0.0-dev';

const program = new Command();

program
  .name('scheck')
  .description('Enforce backend invariants in your codebase')
  .version(version);

// Run command - scan for security invariants
program
  .command('run')
  .description('Scan for security invariants')
  .option('-p, --path <path>', 'Target path to audit (default: current directory)')
  .option('-a, --artifact <path>', 'Use pre-collected artifact from scc (skips collection)')
  .option('--changed', 'Only check changed files (requires git)')
  .option('--ci', 'CI mode - fail on new violations')
  // Output control
  .option('--all', 'Show all findings (don\'t stop early, include P2)')
  .option('--include-p2', 'Include P2 (medium) findings')
  .option('--only <invariants...>', 'Only run specific invariant checks')
  .option('--skip <invariants...>', 'Skip specific invariant checks')
  .option('--json', 'Output results as JSON')
  .option('--sarif <path>', 'Write SARIF report to file (for GitHub Code Scanning)')
  .option('--quiet', 'Suppress output except errors')
  .option('-v, --verbose', 'Enable verbose output')
  // Cloud control
  .option('--calibrate', 'Enable calibration API (default: enabled)')
  .option('--offline', 'Disable all API calls (not supported - shows error)')
  .option('--calibration-endpoint <url>', 'Override calibration API endpoint')
  .option('--patterns', 'Enable Pro Patterns fetching (default: enabled)')
  .option('--no-patterns', 'Disable Pro Patterns fetching')
  .option('--pattern-endpoint <url>', 'Override patterns API endpoint')
  .option('--patterns-file <path>', 'Load patterns from local JSON file (dev/testing)')
  .option('-w, --watch', 'Watch for file changes and re-run')
  .option('--no-local-scan', 'Skip local source-level pattern scanning')
  .option('--no-usage-banner', 'Suppress periodic API usage reminders')
  .action((options) => {
    logger.configure({
      verbose: options.verbose,
      silent: options.quiet,
      json: options.json,
    });
    return runCommand(options);
  });

// Explain command - explain an invariant
program
  .command('explain <invariant>')
  .description('Deep-dive on any invariant (why it matters, what good looks like)')
  .action(explainCommand);

// Init command - initialize SecurityChecks in a project
program
  .command('init')
  .description('Initialize SecurityChecks in a project')
  .option('-p, --path <path>', 'Target path (default: current directory)')
  .option('--hooks', 'Install git pre-commit hook to run checks before commits')
  .action(initCommand);

// Hooks command - manage git hooks
program
  .command('hooks')
  .description('Manage git pre-commit hooks')
  .option('-p, --path <path>', 'Target path (default: current directory)')
  .option('--install', 'Install pre-commit hook')
  .option('--uninstall', 'Uninstall pre-commit hook')
  .option('--show', 'Show current hook status (default)')
  .action(hooksCommand);

// Baseline command - manage baseline of known issues
program
  .command('baseline')
  .description('Manage the baseline of known issues')
  .option('-p, --path <path>', 'Target path (default: current directory)')
  .option('--update', 'Update baseline with current findings')
  .option('--show', 'Show current baseline')
  .option('--prune', 'Remove stale entries not seen recently')
  .option('--prune-days <days>', 'Days before considering stale (default: 90)')
  .option('--notes <notes>', 'Notes to attach to new baseline entries')
  .option('-y, --yes', 'Skip confirmation prompt (for CI/automation)')
  .action(baselineCommand);

// Waive command - temporarily waive a finding
program
  .command('waive <findingId>')
  .description('Temporarily waive a finding (use full findingId or invariant)')
  .option('-p, --path <path>', 'Target path (default: current directory)')
  .option('-r, --reason <reason>', 'Reason for waiving (required)')
  .option('--reason-key <key>', 'Reason key (optional): false_positive, acceptable_risk, will_fix_later, not_applicable, other')
  .option('-e, --expires <duration>', 'Expiration duration (e.g., 7d, 30d, 90d)', '30d')
  .option('-o, --owner <owner>', 'Owner/contact for this waiver')
  .action(waiveCommand);

// Waiver command - manage waivers
program
  .command('waiver')
  .description('View and manage temporary waivers')
  .option('-p, --path <path>', 'Target path (default: current directory)')
  .option('--show', 'Show all active waivers')
  .option('--expiring', 'Show waivers expiring soon')
  .option('--expiring-days <days>', 'Days to consider "expiring soon" (default: 7)')
  .option('--prune', 'Remove expired waivers')
  .action(waiverCommand);

// Feedback command - report finding quality
program
  .command('feedback <invariantId>')
  .description('Report whether a finding was a true positive or false positive')
  .option('-p, --path <path>', 'Target path (default: current directory)')
  .option('--verdict <verdict>', 'Verdict: tp (true positive) or fp (false positive)')
  .option('--reason <reason>', 'Reason: not_applicable, acceptable_risk, wrong_location, outdated_pattern, missing_context')
  .option('--endpoint <url>', 'Feedback endpoint URL (or set SECURITYCHECKS_FEEDBACK_URL)')
  .action(feedbackCommand);

// ==========================================
// Cloud commands
// ==========================================

// Login command - authenticate with cloud
program
  .command('login')
  .description('Authenticate with SecurityChecks cloud')
  .option('-k, --api-key <key>', 'API key (or set SECURITYCHECKS_API_KEY)')
  .option('--api-url <url>', 'Custom API URL (for self-hosted)')
  .option('--check', 'Check current login status')
  .action(loginCommand);

// Logout command - clear cloud credentials
program
  .command('logout')
  .description('Log out from SecurityChecks cloud')
  .action(logoutCommand);

// Config command - manage cloud configuration
program
  .command('config')
  .description('Manage cloud configuration')
  .option('--show', 'Show current configuration')
  .option('--set <key=value>', 'Set a configuration value')
  .option('--unset <key>', 'Unset a configuration value')
  .option('--clear', 'Clear all configuration')
  .option('--project <slug>', 'Set default project')
  .option('--api-url <url>', 'Set API URL')
  .option('--cloud-enabled', 'Enable cloud mode')
  .option('--no-cloud-enabled', 'Disable cloud mode')
  .action(configCommand);

// Sync command - sync findings to cloud
program
  .command('sync')
  .description('Sync scan results to SecurityChecks cloud')
  .option('--project <slug>', 'Project slug')
  .option('--branch <name>', 'Git branch name')
  .option('--commit <sha>', 'Git commit SHA')
  .option('--findings <path>', 'Path to findings file')
  .option('--dry-run', 'Show what would be synced without syncing')
  .action(syncCommand);

program.parse();
