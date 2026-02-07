/**
 * @securitychecks/cli - Library exports
 *
 * This module provides the programmatic API for the SecurityChecks CLI (scheck).
 * Use these exports when integrating scheck into other tools.
 *
 * Note: Checker logic has moved to @securitychecks/engine for cloud evaluation.
 * The CLI is now a thin client that submits artifacts to the cloud API.
 */

// Main audit API
export { audit, type AuditOptions } from './audit.js';

// NOTE: Engine exports REMOVED for security
// Detection logic runs server-side only to protect IP.
// Use evaluateCloud() to get findings via the cloud API.
// See: docs/POST_MORTEM_001_ENGINE_EXPOSURE.md

// Schema validation
export {
  validateSchemaVersion,
  getCurrentSchemaVersion,
  SUPPORTED_SCHEMA_RANGE,
  type SchemaValidationResult,
} from './lib/schema.js';

// Error handling
export {
  CLIError,
  ErrorCodes,
  ErrorMessages,
  ErrorRemediation,
  isCLIError,
  wrapError,
  type ErrorCode,
} from './lib/errors.js';

// Cloud evaluation
export {
  evaluateCloud,
  isCloudEvalAvailable,
  checkCloudHealth,
  getCloudInvariants,
  type CloudEvaluateOptions,
  type CloudEvaluateResult,
  type EvaluationProgressCallback,
} from './lib/cloud-eval.js';

// Finding identity (for baselines/waivers)
export {
  generateFindingId,
  attachFindingId,
  attachFindingIds,
  extractIdentityPayload,
} from './findings/index.js';

// Baseline and waiver management
export {
  // Schema versions
  BASELINE_SCHEMA_VERSION,
  WAIVER_SCHEMA_VERSION,
  // Storage
  loadBaseline,
  saveBaseline,
  addToBaseline,
  isInBaseline,
  pruneBaseline,
  loadWaivers,
  saveWaivers,
  addWaiver,
  getValidWaiver,
  pruneExpiredWaivers,
  getExpiringWaivers,
  // Categorization
  categorizeFindings,
  getCIExitCode,
  getCISummary,
  resolveCollisions,
  hasCollisions,
  // Types
  type BaselineEntry,
  type BaselineFile,
  type WaiverEntry,
  type WaiverFile,
  type CategorizedFinding,
  type CategorizationResult,
} from './baseline/index.js';

// Finding correlation (compounding risks)
export {
  correlateFindings,
  formatCorrelatedFinding,
  formatCorrelationStats,
  type CorrelatedFinding,
  type SharedContext,
  type CompoundingEffect,
  type AttackPath,
  type AttackStep,
  type CorrelationResult,
} from './lib/correlation.js';

// Correlation telemetry (SaaS reporting)
export {
  reportCorrelations,
  reportCorrelationFeedback,
  type CorrelationTelemetryConfig,
} from './lib/correlation-telemetry.js';

// Anonymous telemetry (aggregate learning)
export {
  buildTelemetry,
  reportTelemetry,
  isTelemetryDisabled,
  type TelemetryConfig,
  type ScanTelemetry,
} from './lib/telemetry.js';

// Aggregate calibration (SaaS learning loop)
export {
  fetchAggregateCalibration,
  clearAggregateCache,
  getFrameworkBaseline,
  shouldSkipPattern,
  getSkippedPatterns,
  getVerifiedCorrelations,
  calculateRelativeSeverity,
  formatAggregateCalibrationSummary,
  isAggregateCalibrationDisabled,
  type AggregateCalibrationConfig,
  type AggregateCalibrationData,
  type AggregateCalibrationResult,
  type FrameworkBaseline,
  type InvariantStats,
  type PatternStats,
  type CorrelationStats,
} from './lib/calibration.js';
