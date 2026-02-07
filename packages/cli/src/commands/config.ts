/**
 * Config command - manage SecurityChecks cloud configuration
 */

import pc from 'picocolors';
import {
  loadCloudConfig,
  updateCloudConfig,
  clearCloudConfig,
  formatConfig,
  CONFIG_FILE,
} from '../lib/cloud-config.js';
import { CLIError, ErrorCodes } from '../lib/errors.js';

interface ConfigOptions {
  show?: boolean;
  set?: string;
  unset?: string;
  clear?: boolean;
  project?: string;
  apiUrl?: string;
  cloudEnabled?: boolean;
}

const ALLOWED_KEYS = ['project', 'apiUrl', 'cloudEnabled'] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

function isAllowedKey(key: string): key is AllowedKey {
  return ALLOWED_KEYS.includes(key as AllowedKey);
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  try {
    const config = await loadCloudConfig();

    // Show current config
    if (options.show || Object.keys(options).length === 0) {
      console.log('');
      console.log(formatConfig(config));
      console.log('');
      console.log(pc.dim(`Config file: ${CONFIG_FILE}`));
      console.log('');
      return;
    }

    // Clear all configuration
    if (options.clear) {
      await clearCloudConfig();
      console.log(pc.green('✓ Configuration cleared.\n'));
      return;
    }

    // Set a value
    if (options.set) {
      const [key, ...valueParts] = options.set.split('=');
      const value = valueParts.join('=');

      if (!key || !value) {
        throw new CLIError(
          ErrorCodes.CLI_INVALID_ARGUMENT,
          'Set requires format: --set key=value'
        );
      }

      if (!isAllowedKey(key)) {
        throw new CLIError(
          ErrorCodes.CLI_INVALID_ARGUMENT,
          `Invalid config key: ${key}. Allowed keys: ${ALLOWED_KEYS.join(', ')}`
        );
      }

      // Handle boolean values
      let parsedValue: string | boolean = value;
      if (key === 'cloudEnabled') {
        parsedValue = value === 'true' || value === '1';
      }

      await updateCloudConfig({ [key]: parsedValue });
      console.log(pc.green(`✓ Set ${key} = ${parsedValue}\n`));
      return;
    }

    // Unset a value
    if (options.unset) {
      const key = options.unset;

      if (!isAllowedKey(key)) {
        throw new CLIError(
          ErrorCodes.CLI_INVALID_ARGUMENT,
          `Invalid config key: ${key}. Allowed keys: ${ALLOWED_KEYS.join(', ')}`
        );
      }

      await updateCloudConfig({ [key]: undefined });
      console.log(pc.green(`✓ Unset ${key}\n`));
      return;
    }

    // Shorthand options for common settings
    if (options.project !== undefined) {
      await updateCloudConfig({ project: options.project });
      console.log(pc.green(`✓ Set project = ${options.project}\n`));
    }

    if (options.apiUrl !== undefined) {
      await updateCloudConfig({ apiUrl: options.apiUrl });
      console.log(pc.green(`✓ Set apiUrl = ${options.apiUrl}\n`));
    }

    if (options.cloudEnabled !== undefined) {
      await updateCloudConfig({ cloudEnabled: options.cloudEnabled });
      console.log(pc.green(`✓ Set cloudEnabled = ${options.cloudEnabled}\n`));
    }
  } catch (error) {
    if (error instanceof CLIError) {
      console.error(pc.red(`\n✗ ${error.message}\n`));
      const remediation = error.getRemediation();
      if (remediation) {
        console.error(pc.yellow('How to fix:'));
        for (const line of remediation.split('\n')) {
          console.error(pc.dim(`  ${line}`));
        }
        console.error('');
      }
    } else {
      console.error(pc.red(`\n✗ Config failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    }
    process.exit(1);
  }
}
