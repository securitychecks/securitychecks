/**
 * Simple file watcher for watch mode
 *
 * Uses Node.js fs.watch with recursive watching where supported (macOS, Windows)
 * Falls back to polling on Linux
 */

import { watch, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { EventEmitter } from 'node:events';

const DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 1000;

// File extensions to watch
const WATCH_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

// Directories to ignore
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.securitychecks',
  '.scheck',
]);

interface WatcherOptions {
  targetPath: string;
  onChanged: () => Promise<void>;
  verbose?: boolean;
}

export class FileWatcher extends EventEmitter {
  private targetPath: string;
  private onChanged: () => Promise<void>;
  private verbose: boolean;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private watchers: ReturnType<typeof watch>[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastModTimes = new Map<string, number>();

  constructor(options: WatcherOptions) {
    super();
    this.targetPath = options.targetPath;
    this.onChanged = options.onChanged;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Start watching for file changes
   */
  start(): void {
    // Try recursive watching first (works on macOS, Windows)
    try {
      const watcher = watch(
        this.targetPath,
        { recursive: true },
        (eventType, filename) => {
          if (filename && this.shouldTrigger(filename)) {
            this.scheduleRun(filename);
          }
        }
      );

      watcher.on('error', (error) => {
        if (this.verbose) {
          console.error('Watch error:', error.message);
        }
        // Fall back to polling
        this.stopWatchers();
        this.startPolling();
      });

      this.watchers.push(watcher);

      if (this.verbose) {
        console.log('File watcher started (recursive mode)');
      }
    } catch {
      // Recursive watching not supported, use polling
      this.startPolling();
    }
  }

  /**
   * Start polling-based watching (fallback for Linux)
   */
  private startPolling(): void {
    if (this.verbose) {
      console.log('File watcher started (polling mode)');
    }

    // Initial scan
    this.scanFiles(this.targetPath);

    this.pollTimer = setInterval(() => {
      const changed = this.checkForChanges(this.targetPath);
      if (changed) {
        this.scheduleRun(changed);
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Scan directory recursively and record modification times
   */
  private scanFiles(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          this.scanFiles(fullPath);
        } else if (entry.isFile() && WATCH_EXTENSIONS.has(extname(entry.name))) {
          try {
            const stat = statSync(fullPath);
            this.lastModTimes.set(fullPath, stat.mtimeMs);
          } catch {
            // File may have been deleted
          }
        }
      }
    } catch {
      // Directory may not exist or be readable
    }
  }

  /**
   * Check for file changes
   */
  private checkForChanges(dir: string): string | null {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          const changed = this.checkForChanges(fullPath);
          if (changed) return changed;
        } else if (entry.isFile() && WATCH_EXTENSIONS.has(extname(entry.name))) {
          try {
            const stat = statSync(fullPath);
            const lastMod = this.lastModTimes.get(fullPath);

            if (!lastMod || stat.mtimeMs > lastMod) {
              this.lastModTimes.set(fullPath, stat.mtimeMs);
              if (lastMod) return fullPath; // Only trigger on actual changes, not initial scan
            }
          } catch {
            // File may have been deleted
          }
        }
      }
    } catch {
      // Directory may not exist
    }

    return null;
  }

  /**
   * Check if a file change should trigger a re-run
   */
  private shouldTrigger(filename: string): boolean {
    // Check extension
    const ext = extname(filename);
    if (!WATCH_EXTENSIONS.has(ext)) return false;

    // Check for ignored directories in path
    const parts = filename.split(/[/\\]/);
    for (const part of parts) {
      if (IGNORE_DIRS.has(part)) return false;
    }

    return true;
  }

  /**
   * Schedule a run with debouncing
   */
  private scheduleRun(filename: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      if (this.isRunning) return;

      this.isRunning = true;
      this.emit('change', filename);

      try {
        await this.onChanged();
      } catch {
        // Error handled by callback
      } finally {
        this.isRunning = false;
      }
    }, DEBOUNCE_MS);
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.stopWatchers();

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private stopWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }
}
