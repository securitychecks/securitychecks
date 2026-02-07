/**
 * Structured Logger for SecurityChecks CLI
 *
 * Features:
 * - Log levels: debug, info, warn, error
 * - Verbose mode support
 * - Silent mode for JSON output
 * - Automatic redaction of sensitive data
 */

import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  verbose?: boolean;
  silent?: boolean;
  json?: boolean;
}

/**
 * Patterns that indicate sensitive data to redact
 */
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /auth/i,
];

/**
 * Prefixes that indicate sensitive values
 */
const SENSITIVE_PREFIXES = ['sk_', 'pk_', 'Bearer ', 'Basic '];

class Logger {
  private verbose = false;
  private silent = false;
  private json = false;

  configure(options: LoggerOptions): void {
    this.verbose = options.verbose ?? false;
    this.silent = options.silent ?? false;
    this.json = options.json ?? false;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (!this.verbose || this.silent) return;
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.silent) return;
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.silent) return;
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  /**
   * Log a step in a process (for progress indication)
   */
  step(step: number, total: number, message: string): void {
    if (this.silent) return;
    console.log(pc.dim(`[${step}/${total}]`), message);
  }

  /**
   * Log a success message
   */
  success(message: string): void {
    if (this.silent) return;
    console.log(pc.green('✓'), message);
  }

  /**
   * Log a failure message
   */
  fail(message: string): void {
    console.log(pc.red('✗'), message);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const redactedData = data ? this.redact(data) : undefined;

    if (this.json) {
      console.log(
        JSON.stringify({
          timestamp,
          level,
          message,
          ...(redactedData && { data: redactedData }),
        })
      );
      return;
    }

    const prefix = this.getPrefix(level);
    const formattedMessage = `${prefix} ${message}`;

    if (level === 'error') {
      console.error(formattedMessage);
    } else {
      console.log(formattedMessage);
    }

    if (this.verbose && redactedData) {
      console.log(pc.dim(JSON.stringify(redactedData, null, 2)));
    }
  }

  private getPrefix(level: LogLevel): string {
    switch (level) {
      case 'debug':
        return pc.dim('[DEBUG]');
      case 'info':
        return pc.blue('[INFO]');
      case 'warn':
        return pc.yellow('[WARN]');
      case 'error':
        return pc.red('[ERROR]');
    }
  }

  /**
   * Redact sensitive data from log output
   */
  private redact(data: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (this.isSensitiveKey(key)) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'string' && this.isSensitiveValue(value)) {
        redacted[key] = this.redactValue(value);
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redact(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  private isSensitiveKey(key: string): boolean {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
  }

  private isSensitiveValue(value: string): boolean {
    return SENSITIVE_PREFIXES.some((prefix) => value.startsWith(prefix));
  }

  private redactValue(value: string): string {
    if (value.length <= 8) {
      return '[REDACTED]';
    }
    return value.slice(0, 4) + '...' + value.slice(-4);
  }
}

// Singleton logger instance
export const logger = new Logger();

// Convenience exports
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const step = logger.step.bind(logger);
export const success = logger.success.bind(logger);
export const fail = logger.fail.bind(logger);
