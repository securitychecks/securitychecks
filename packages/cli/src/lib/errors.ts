/**
 * Deterministic Error Codes for SecurityChecks CLI
 *
 * Format: SC_<CATEGORY>_<NUMBER>
 *
 * Categories:
 * - CONFIG: Configuration errors
 * - PARSE: Parsing/syntax errors
 * - CHECK: Checker execution errors
 * - IO: File system / network errors
 * - CLI: Command line argument errors
 */

export const ErrorCodes = {
  // CONFIG errors (001-099)
  CONFIG_NOT_FOUND: 'SC_CONFIG_001',
  CONFIG_INVALID: 'SC_CONFIG_002',
  CONFIG_SCHEMA_ERROR: 'SC_CONFIG_003',

  // PARSE errors (100-199)
  PARSE_TYPESCRIPT_ERROR: 'SC_PARSE_101',
  PARSE_FILE_NOT_FOUND: 'SC_PARSE_102',
  PARSE_UNSUPPORTED_SYNTAX: 'SC_PARSE_103',

  // CHECK errors (200-299)
  CHECK_EXECUTION_ERROR: 'SC_CHECK_201',
  CHECK_TIMEOUT: 'SC_CHECK_202',
  CHECK_INVARIANT_NOT_FOUND: 'SC_CHECK_203',

  // IO errors (300-399)
  IO_READ_ERROR: 'SC_IO_301',
  IO_WRITE_ERROR: 'SC_IO_302',
  IO_PERMISSION_DENIED: 'SC_IO_303',
  IO_PATH_NOT_FOUND: 'SC_IO_304',

  // CLI errors (400-499)
  CLI_INVALID_ARGUMENT: 'SC_CLI_401',
  CLI_MISSING_ARGUMENT: 'SC_CLI_402',
  CLI_UNKNOWN_COMMAND: 'SC_CLI_403',

  // ARTIFACT errors (500-599)
  ARTIFACT_NOT_FOUND: 'SC_ARTIFACT_501',
  ARTIFACT_INVALID: 'SC_ARTIFACT_502',
  ARTIFACT_VERSION_MISMATCH: 'SC_ARTIFACT_503',

  // CLOUD errors (600-699)
  CLOUD_AUTH_FAILED: 'SC_CLOUD_601',
  CLOUD_PERMISSION_DENIED: 'SC_CLOUD_602',
  CLOUD_NOT_FOUND: 'SC_CLOUD_603',
  CLOUD_RATE_LIMITED: 'SC_CLOUD_604',
  CLOUD_API_ERROR: 'SC_CLOUD_605',
  CLOUD_NETWORK_ERROR: 'SC_CLOUD_606',
  CLOUD_INVALID_API_KEY: 'SC_CLOUD_607',
  AUTH_REQUIRED: 'SC_CLOUD_608',
  OFFLINE_NOT_SUPPORTED: 'SC_CLOUD_609',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * User-friendly error messages for each error code
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCodes.CONFIG_NOT_FOUND]: 'Configuration file not found',
  [ErrorCodes.CONFIG_INVALID]: 'Configuration file is invalid',
  [ErrorCodes.CONFIG_SCHEMA_ERROR]: 'Configuration does not match expected schema',

  [ErrorCodes.PARSE_TYPESCRIPT_ERROR]: 'Failed to parse TypeScript file',
  [ErrorCodes.PARSE_FILE_NOT_FOUND]: 'Source file not found',
  [ErrorCodes.PARSE_UNSUPPORTED_SYNTAX]: 'Unsupported syntax encountered',

  [ErrorCodes.CHECK_EXECUTION_ERROR]: 'Error executing invariant check',
  [ErrorCodes.CHECK_TIMEOUT]: 'Invariant check timed out',
  [ErrorCodes.CHECK_INVARIANT_NOT_FOUND]: 'Invariant not found',

  [ErrorCodes.IO_READ_ERROR]: 'Failed to read file',
  [ErrorCodes.IO_WRITE_ERROR]: 'Failed to write file',
  [ErrorCodes.IO_PERMISSION_DENIED]: 'Permission denied',
  [ErrorCodes.IO_PATH_NOT_FOUND]: 'Path not found',

  [ErrorCodes.CLI_INVALID_ARGUMENT]: 'Invalid argument provided',
  [ErrorCodes.CLI_MISSING_ARGUMENT]: 'Required argument missing',
  [ErrorCodes.CLI_UNKNOWN_COMMAND]: 'Unknown command',

  [ErrorCodes.ARTIFACT_NOT_FOUND]: 'Artifact file not found',
  [ErrorCodes.ARTIFACT_INVALID]: 'Invalid artifact format',
  [ErrorCodes.ARTIFACT_VERSION_MISMATCH]: 'Artifact version not supported',

  [ErrorCodes.CLOUD_AUTH_FAILED]: 'Authentication failed',
  [ErrorCodes.CLOUD_PERMISSION_DENIED]: 'Permission denied',
  [ErrorCodes.CLOUD_NOT_FOUND]: 'Resource not found',
  [ErrorCodes.CLOUD_RATE_LIMITED]: 'Rate limit exceeded',
  [ErrorCodes.CLOUD_API_ERROR]: 'Cloud API error',
  [ErrorCodes.CLOUD_NETWORK_ERROR]: 'Network error',
  [ErrorCodes.CLOUD_INVALID_API_KEY]: 'Invalid API key format',
  [ErrorCodes.AUTH_REQUIRED]: 'API key required for evaluation',
  [ErrorCodes.OFFLINE_NOT_SUPPORTED]: 'Offline mode is not supported',
};

/**
 * Remediation guidance for each error code
 * Helps users understand what to do when they encounter an error.
 */
export const ErrorRemediation: Record<ErrorCode, string> = {
  // CONFIG errors
  [ErrorCodes.CONFIG_NOT_FOUND]: `
Create a configuration file in your project root:

  scheck init

Or create securitychecks.config.ts manually:

  export default {
    include: ['src/**/*.ts'],
    exclude: ['node_modules/**'],
  };
`.trim(),

  [ErrorCodes.CONFIG_INVALID]: `
Check your securitychecks.config.ts for syntax errors.

Common issues:
- Missing export default
- Invalid JSON in securitychecks.json
- Typo in configuration keys

Run with --verbose for more details.
`.trim(),

  [ErrorCodes.CONFIG_SCHEMA_ERROR]: `
Your configuration has invalid options. Check these common issues:

- 'include' and 'exclude' must be arrays of glob patterns
- 'testPatterns' must be an array of test file patterns
- 'servicePatterns' must be an array of service file patterns

See: https://securitychecks.ai/docs/configuration
`.trim(),

  // PARSE errors
  [ErrorCodes.PARSE_TYPESCRIPT_ERROR]: `
A TypeScript file failed to parse. This usually means:

1. The file has syntax errors - run tsc to check
2. The file uses unsupported TypeScript features
3. There are missing dependencies

Try:
  npx tsc --noEmit

If the error persists, exclude the problematic file:
  exclude: ['path/to/problematic-file.ts']
`.trim(),

  [ErrorCodes.PARSE_FILE_NOT_FOUND]: `
The specified source file doesn't exist. Check:

1. The file path is correct
2. The file hasn't been moved or deleted
3. Your include/exclude patterns are correct

Run: ls <path> to verify the file exists.
`.trim(),

  [ErrorCodes.PARSE_UNSUPPORTED_SYNTAX]: `
The file contains syntax that can't be parsed. This may happen with:

- Very new TypeScript/JavaScript features
- Non-standard syntax extensions
- Malformed source code

Try excluding the file or updating the parser.
`.trim(),

  // CHECK errors
  [ErrorCodes.CHECK_EXECUTION_ERROR]: `
An invariant check failed to run. This is usually a bug in scheck.

Please report this issue with:
1. The full error message (--verbose)
2. A minimal reproduction
3. Your Node.js and @securitychecks/cli versions

Report at: https://github.com/securitychecks/securitychecks.ai/issues
`.trim(),

  [ErrorCodes.CHECK_TIMEOUT]: `
An invariant check took too long. This can happen with:

1. Very large codebases
2. Complex file structures
3. Slow file system access

Try:
- Narrowing include patterns to scan fewer files
- Excluding large generated files
- Running with --only to check specific invariants
`.trim(),

  [ErrorCodes.CHECK_INVARIANT_NOT_FOUND]: `
The specified invariant ID doesn't exist.

List available invariants:
  scheck explain --list

Common invariant IDs:
- AUTHZ.SERVICE_LAYER.ENFORCED
- WEBHOOK.IDEMPOTENT
- TRANSACTION.POST_COMMIT.SIDE_EFFECTS
`.trim(),

  // IO errors
  [ErrorCodes.IO_READ_ERROR]: `
Failed to read a file. Check:

1. The file exists and is readable
2. You have permission to read the file
3. The file is not locked by another process

Try: cat <file> to verify readability.
`.trim(),

  [ErrorCodes.IO_WRITE_ERROR]: `
Failed to write a file. Check:

1. The directory exists
2. You have write permission
3. There's enough disk space
4. The file is not locked

Try: touch <file> to verify writability.
`.trim(),

  [ErrorCodes.IO_PERMISSION_DENIED]: `
Permission denied accessing a file or directory.

On Unix/Mac:
  chmod +r <file>  # Make readable
  chmod +w <file>  # Make writable

On Windows: Check file properties > Security tab.
`.trim(),

  [ErrorCodes.IO_PATH_NOT_FOUND]: `
The specified path doesn't exist.

Check:
1. You're in the correct directory
2. The path is spelled correctly
3. The directory structure is correct

Run: pwd && ls to verify your location.
`.trim(),

  // CLI errors
  [ErrorCodes.CLI_INVALID_ARGUMENT]: `
Invalid command-line argument.

Run: scheck --help

Common commands:
  scheck run              # Run all checks
  scheck run --ci         # CI mode (fails on P0/P1)
  scheck explain <id>     # Explain an invariant
  scheck init             # Initialize configuration
`.trim(),

  [ErrorCodes.CLI_MISSING_ARGUMENT]: `
A required argument is missing.

Check the command syntax:
  scheck --help
  scheck <command> --help
`.trim(),

  [ErrorCodes.CLI_UNKNOWN_COMMAND]: `
Unknown command. Available commands:

  run       Run invariant checks
  init      Initialize configuration
  explain   Explain an invariant
  baseline  Manage baseline
  waive     Waive a finding

Run: scheck --help
`.trim(),

  // ARTIFACT errors
  [ErrorCodes.ARTIFACT_NOT_FOUND]: `
Artifact file not found.

The artifact file stores collected code facts. Options:

1. Let scheck collect automatically (default):
   scheck run

2. Collect manually first:
   npx scc collect -o .securitychecks/artifacts.json
   scheck run --artifact .securitychecks/artifacts.json

3. Check if file was deleted:
   ls .securitychecks/
`.trim(),

  [ErrorCodes.ARTIFACT_INVALID]: `
The artifact file is malformed or corrupt.

Common issues:
- Incomplete JSON (process was killed during write)
- Modified manually with syntax errors
- Wrong file format

Fix:
1. Delete the corrupt artifact:
   rm .securitychecks/artifacts.json

2. Re-collect:
   scheck run
   (or: npx scc collect -o .securitychecks/artifacts.json)
`.trim(),

  [ErrorCodes.ARTIFACT_VERSION_MISMATCH]: `
The artifact was created by an incompatible version.

This happens when:
- Artifact was created by an older/newer scheck version
- Artifact schema has changed

Fix:
1. Delete the old artifact:
   rm .securitychecks/artifacts.json

2. Re-collect with current version:
   scheck run

Your current version: scheck --version
`.trim(),

  // CLOUD errors
  [ErrorCodes.CLOUD_AUTH_FAILED]: `
Authentication failed. Your API key may be invalid or expired.

Fix:
1. Generate a new API key at https://securitychecks.ai/dashboard/settings/api-keys
2. Log in again:
   scheck login

Environment variable:
  export SECURITYCHECKS_API_KEY=sc_live_...
`.trim(),

  [ErrorCodes.CLOUD_PERMISSION_DENIED]: `
You don't have permission for this action.

Check:
1. You have access to the project/organization
2. Your API key has the required scopes
3. Your subscription is active

Manage at: https://securitychecks.ai/dashboard
`.trim(),

  [ErrorCodes.CLOUD_NOT_FOUND]: `
The requested resource was not found.

Check:
1. The project slug is correct
2. The project exists and you have access
3. The resource ID is valid

List your projects:
  scheck config --show
`.trim(),

  [ErrorCodes.CLOUD_RATE_LIMITED]: `
You've hit the rate limit. Please try again later.

Options:
1. Wait a few minutes and retry
2. Upgrade your plan for higher limits

Plan limits: https://securitychecks.ai/pricing
`.trim(),

  [ErrorCodes.CLOUD_API_ERROR]: `
The SecurityChecks API returned an error.

This could be:
1. A temporary service issue - try again shortly
2. An invalid request - check your parameters

Status: https://status.securitychecks.ai
Help: https://securitychecks.ai/docs/troubleshooting
`.trim(),

  [ErrorCodes.CLOUD_NETWORK_ERROR]: `
Could not connect to SecurityChecks API.

Check:
1. Your internet connection
2. Firewall/proxy settings
3. API endpoint accessibility

Default API: https://api.securitychecks.ai
`.trim(),

  [ErrorCodes.CLOUD_INVALID_API_KEY]: `
The API key format is invalid.

API keys should start with:
- sc_live_ for production
- sc_test_ for testing

Get a key at: https://securitychecks.ai/dashboard/settings/api-keys
`.trim(),

  [ErrorCodes.AUTH_REQUIRED]: `
An API key is required to run security checks.

SecurityChecks uses cloud evaluation to protect proprietary patterns.
Your source code never leaves your machine - only structural facts are sent.

Setup:
1. Get your API key at https://securitychecks.ai/dashboard/settings/api-keys
2. Set environment variable:
   export SECURITYCHECKS_API_KEY=sc_live_...

Or add to securitychecks.config.yaml:
  calibration:
    apiKey: sc_live_...
`.trim(),

  [ErrorCodes.OFFLINE_NOT_SUPPORTED]: `
Offline mode is not supported.

SecurityChecks requires cloud evaluation to protect proprietary patterns.
Your source code never leaves your machine - only structural facts are sent.

Options:
1. Remove --offline flag and ensure network connectivity
2. For air-gapped environments, contact sales for an enterprise on-premise license:
   https://securitychecks.ai/enterprise
`.trim(),
};

/**
 * Structured CLI Error with deterministic error code
 */
export class CLIError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public override readonly cause?: Error;

  constructor(code: ErrorCode, message?: string, options?: { details?: unknown; cause?: Error }) {
    const baseMessage = message ?? ErrorMessages[code];
    super(baseMessage, { cause: options?.cause });

    this.name = 'CLIError';
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, CLIError);
  }

  /**
   * Get remediation guidance for this error
   */
  getRemediation(): string {
    return ErrorRemediation[this.code];
  }

  /**
   * Format error for user display
   */
  toUserString(verbose = false): string {
    const parts: string[] = [`[${this.code}] ${this.message}`];

    if (verbose && this.details) {
      parts.push(`\nDetails: ${JSON.stringify(this.details, null, 2)}`);
    }

    if (verbose && this.cause) {
      parts.push(`\nCaused by: ${this.cause.message}`);
      if (this.cause.stack) {
        parts.push(`\n${this.cause.stack}`);
      }
    }

    return parts.join('');
  }

  /**
   * Format error with remediation for user display
   */
  toUserStringWithRemediation(): string {
    const parts: string[] = [this.toUserString()];
    const remediation = this.getRemediation();

    if (remediation) {
      parts.push('\n\nHow to fix:\n');
      // Indent each line of remediation
      const indented = remediation
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      parts.push(indented);
    }

    return parts.join('');
  }

  /**
   * Format error for JSON output
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      remediation: this.getRemediation(),
      details: this.details,
      cause: this.cause
        ? {
            message: this.cause.message,
            stack: this.cause.stack,
          }
        : undefined,
    };
  }
}

/**
 * Check if an error is a CLIError
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof CLIError;
}

/**
 * Wrap an unknown error in a CLIError
 */
export function wrapError(error: unknown, code: ErrorCode, message?: string): CLIError {
  if (error instanceof CLIError) {
    return error;
  }

  const cause = error instanceof Error ? error : new Error(String(error));
  return new CLIError(code, message, { cause });
}
