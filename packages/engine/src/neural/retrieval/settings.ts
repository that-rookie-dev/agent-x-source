/**
 * Runtime retrieval settings — defaults + optional config overrides.
 * All call sites should use getRetrievalSettings() instead of raw RETRIEVAL_DEFAULTS
 * when they need live knobs (hybrid, scores, budgets).
 */
import { RETRIEVAL_DEFAULTS, type RetrievalDefaults } from './defaults.js';

export type RetrievalSettings = {
  -readonly [K in keyof RetrievalDefaults]: RetrievalDefaults[K];
};

let overrides: Partial<RetrievalSettings> = {};

/** Apply overrides from AgentX config.retrieval (or tests). */
export function setRetrievalOverrides(partial: Partial<RetrievalSettings> | null | undefined): void {
  if (!partial) {
    overrides = {};
    return;
  }
  overrides = { ...overrides, ...partial };
}

export function resetRetrievalOverrides(): void {
  overrides = {};
}

export function getRetrievalSettings(): RetrievalSettings {
  return {
    ...RETRIEVAL_DEFAULTS,
    ...overrides,
  };
}
