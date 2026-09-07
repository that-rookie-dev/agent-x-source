/**
 * Backward-compatible alias for `QaEngineerRole`.
 *
 * The original `VerifierRole` has been superseded by `QaEngineerRole` which implements the
 * full MetaGPT QaEngineer action sequence (WriteTest → RunCode → DebugError) in addition
 * to the deterministic verification checks. This file re-exports QaEngineerRole under the
 * old name for backward compatibility with existing imports and tests.
 */
export { QaEngineerRole as VerifierRole } from './QaEngineerRole.js';
