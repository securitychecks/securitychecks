/**
 * Artifact Schema Version
 *
 * This is the canonical version for collector artifact compatibility.
 * CLI and other consumers use this to determine if they can process an artifact.
 *
 * Follows semver:
 * - MAJOR: Breaking changes to schema (fields removed, types changed)
 * - MINOR: Additive changes (new optional fields)
 * - PATCH: Bug fixes, clarifications
 *
 * Consumers should check: artifact.schemaVersion satisfies their supported range.
 */

export const ARTIFACT_SCHEMA_VERSION = '1.3.0';
