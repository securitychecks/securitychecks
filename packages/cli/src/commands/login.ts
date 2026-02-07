/**
 * Login command - authenticate with SecurityChecks cloud
 */

import pc from 'picocolors';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  loadCloudConfig,
  updateCloudConfig,
  isValidApiKey,
  getApiUrl,
  formatConfig,
} from '../lib/cloud-config.js';
import { createCloudClient } from '../lib/cloud-api.js';
import { CLIError, ErrorCodes } from '../lib/errors.js';

interface LoginOptions {
  apiKey?: string;
  apiUrl?: string;
  check?: boolean;
}

/**
 * Prompt user for API key interactively
 */
async function promptForApiKey(): Promise<string> {
  const rl = readline.createInterface({ input, output });

  console.log(pc.bold('\nSecurityChecks Cloud Login\n'));
  console.log(pc.dim('Get your API key at: https://securitychecks.ai/dashboard/settings/api-keys\n'));

  try {
    const apiKey = await rl.question('API Key: ');
    return apiKey.trim();
  } finally {
    rl.close();
  }
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  try {
    // Load existing config
    const config = await loadCloudConfig();

    // Check current login status
    if (options.check) {
        if (!config.apiKey) {
          console.log(pc.yellow('Not logged in to SecurityChecks cloud.\n'));
        console.log('Run `scheck login` to authenticate.');
        return;
      }

      const apiUrl = options.apiUrl || getApiUrl(config);
      const client = createCloudClient(apiUrl, config.apiKey);

      try {
        const result = await client.validateKey();
        if (result.valid) {
          console.log(pc.green('✓ Logged in to SecurityChecks cloud\n'));
          console.log(formatConfig(config));
        } else {
          console.log(pc.yellow('API key is invalid or expired.\n'));
          console.log('Run `scheck login` to re-authenticate.');
        }
      } catch (error) {
        if (error instanceof CLIError) {
          console.log(pc.red(`✗ ${error.message}\n`));
        } else {
          console.log(pc.red('✗ Failed to validate API key\n'));
        }
      }
      return;
    }

    // Get API key from options, env, or prompt
    let apiKey = options.apiKey || process.env['SECURITYCHECKS_API_KEY'];

    if (!apiKey) {
      apiKey = await promptForApiKey();
    }

    if (!apiKey) {
      console.log(pc.red('\n✗ No API key provided.\n'));
      process.exit(1);
    }

    // Validate key format
    if (!isValidApiKey(apiKey)) {
      throw new CLIError(
        ErrorCodes.CLOUD_INVALID_API_KEY,
        'Invalid API key format. Keys should start with sc_live_ or sc_test_'
      );
    }

    // Determine API URL
    const apiUrl = options.apiUrl || getApiUrl(config);

    console.log(pc.dim(`\nConnecting to ${apiUrl}...`));

    // Validate key with API
    const client = createCloudClient(apiUrl, apiKey);
    const result = await client.validateKey();

    if (!result.valid) {
      throw new CLIError(ErrorCodes.CLOUD_AUTH_FAILED, 'API key validation failed');
    }

    // Get user info
    const userInfo = await client.getUserInfo();

    // Save configuration
    await updateCloudConfig({
      apiKey,
      apiUrl: options.apiUrl || undefined, // Only save if explicitly provided
      email: userInfo.email,
      organization: userInfo.organizations[0]?.name,
      cloudEnabled: true,
      lastSync: new Date().toISOString(),
    });

    console.log(pc.green('\n✓ Successfully logged in!\n'));
    console.log(`  Email:        ${userInfo.email}`);
    if (userInfo.name) {
      console.log(`  Name:         ${userInfo.name}`);
    }
    if (userInfo.organizations.length > 0) {
      console.log(`  Organization: ${userInfo.organizations[0]?.name}`);
    }
    console.log('');
    console.log(pc.dim('Cloud mode is now enabled by default.'));
    console.log(pc.dim('Run `scheck run --cloud` to sync findings.'));
    console.log('');
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
      console.error(pc.red(`\n✗ Login failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`));
    }
    process.exit(1);
  }
}

export async function logoutCommand(): Promise<void> {
  const config = await loadCloudConfig();

  if (!config.apiKey) {
    console.log(pc.yellow('Not logged in to SecurityChecks cloud.\n'));
    return;
  }

  await updateCloudConfig({
    apiKey: undefined,
    email: undefined,
    organization: undefined,
    cloudEnabled: false,
    lastSync: undefined,
  });

  console.log(pc.green('✓ Successfully logged out.\n'));
  console.log(pc.dim('Cloud mode has been disabled.'));
  console.log('');
}
