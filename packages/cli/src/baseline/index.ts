/**
 * Baseline and Waiver Management
 *
 * Baselines allow incremental adoption - known issues don't fail CI.
 * Waivers provide temporary suppression with required justification.
 */

// Schema and types
export {
  BASELINE_SCHEMA_VERSION,
  WAIVER_SCHEMA_VERSION,
  WAIVER_REASON_KEYS,
  CLI_PACKAGE_NAME,
  getGeneratedBy,
  createEmptyBaseline,
  createEmptyWaiverFile,
  isValidWaiverReasonKey,
  type BaselineEntry,
  type BaselineFile,
  type WaiverEntry,
  type WaiverFile,
  type WaiverReasonKey,
} from './schema.js';

// Storage operations
export {
  getBaselinePath,
  getWaiverPath,
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
} from './storage.js';

// Matching and categorization
export {
  categorizeFindings,
  getCIExitCode,
  getCISummary,
  resolveCollisions,
  hasCollisions,
  type CategorizedFinding,
  type CategorizationResult,
} from './matcher.js';
