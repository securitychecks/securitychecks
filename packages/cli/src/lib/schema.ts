/**
 * Schema Version Compatibility
 *
 * Ensures CLI can consume artifacts from compatible collector versions.
 *
 * The schema version follows semver:
 * - MAJOR: Breaking changes (fields removed, types changed)
 * - MINOR: Additive changes (new optional fields)
 * - PATCH: Bug fixes, clarifications
 *
 * CLI declares a supported range, collector emits current version.
 */

import { ARTIFACT_SCHEMA_VERSION } from '@securitychecks/collector';

/**
 * The schema version range this CLI version supports.
 *
 * Format: "^MAJOR.MINOR.x" - compatible with any version that has:
 * - Same MAJOR version (no breaking changes)
 * - Same or higher MINOR version (may have new optional fields)
 *
 * When updating:
 * - Bump MINOR when CLI starts using new optional fields
 * - Bump MAJOR when CLI requires breaking schema changes
 */
export const SUPPORTED_SCHEMA_RANGE = {
  // Minimum version we can consume
  minMajor: 1,
  minMinor: 0,
  // Maximum major version we understand (breaking changes)
  maxMajor: 1,
};

export interface SchemaValidationResult {
  valid: boolean;
  artifactVersion: string;
  currentVersion: string;
  error?: string;
  remediation?: string;
}

/**
 * Parse a semver string into components
 */
function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Validate that an artifact's schema version is compatible with this CLI.
 *
 * Compatibility rules:
 * - Artifact MAJOR must equal CLI's supported MAJOR (breaking changes)
 * - Artifact MINOR must be >= CLI's minMinor (additive features)
 * - Pre-1.0.0 artifacts (missing schemaVersion) are assumed "1.0.0"
 */
export function validateSchemaVersion(artifactSchemaVersion?: string): SchemaValidationResult {
  const currentVersion = ARTIFACT_SCHEMA_VERSION;

  // Handle missing schemaVersion (pre-versioning artifacts)
  const effectiveVersion = artifactSchemaVersion ?? '1.0.0';

  const parsed = parseSemver(effectiveVersion);
  if (!parsed) {
    return {
      valid: false,
      artifactVersion: effectiveVersion,
      currentVersion,
      error: `Invalid schema version format: "${effectiveVersion}" (expected semver like "1.0.0")`,
      remediation: 'Re-collect artifacts with: npx scc collect -o .securitychecks/artifacts.json',
    };
  }

  const { major, minor } = parsed;

  // Check MAJOR version (breaking changes)
  if (major > SUPPORTED_SCHEMA_RANGE.maxMajor) {
    return {
      valid: false,
      artifactVersion: effectiveVersion,
      currentVersion,
      error: `Artifact schema version ${effectiveVersion} is too new (CLI supports up to ${SUPPORTED_SCHEMA_RANGE.maxMajor}.x.x)`,
      remediation: `Upgrade scheck: npm install -g @securitychecks/cli@latest`,
    };
  }

  if (major < SUPPORTED_SCHEMA_RANGE.minMajor) {
    return {
      valid: false,
      artifactVersion: effectiveVersion,
      currentVersion,
      error: `Artifact schema version ${effectiveVersion} is too old (CLI requires ${SUPPORTED_SCHEMA_RANGE.minMajor}.x.x+)`,
      remediation: 'Re-collect artifacts: npx scc collect -o .securitychecks/artifacts.json',
    };
  }

  // Check MINOR version (additive features - older artifacts may lack fields we use)
  if (minor < SUPPORTED_SCHEMA_RANGE.minMinor) {
    return {
      valid: false,
      artifactVersion: effectiveVersion,
      currentVersion,
      error: `Artifact schema version ${effectiveVersion} is missing required fields (CLI requires ${SUPPORTED_SCHEMA_RANGE.minMajor}.${SUPPORTED_SCHEMA_RANGE.minMinor}.x+)`,
      remediation: 'Re-collect artifacts: npx scc collect -o .securitychecks/artifacts.json',
    };
  }

  return {
    valid: true,
    artifactVersion: effectiveVersion,
    currentVersion,
  };
}

/**
 * Get the current collector schema version
 */
export function getCurrentSchemaVersion(): string {
  return ARTIFACT_SCHEMA_VERSION;
}
