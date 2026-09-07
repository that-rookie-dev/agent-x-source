/**
 * Backward-compatible alias for `EngineerRole`.
 *
 * The original `CoderRole` has been superseded by `EngineerRole` which implements the full
 * MetaGPT Engineer action sequence (WriteCode → WriteCodeReview → SummarizeCode with IS_PASS).
 * This file re-exports EngineerRole under the old name for backward compatibility with
 * existing imports and tests.
 */
export { EngineerRole as CoderRole } from './EngineerRole.js';
