import { cpus } from 'node:os';

export interface RuntimeSettings {
  /**
   * Target CPU budget as a percent of available cores (10–80, default 40).
   * Maps to ONNX thread counts and background worker concurrency. Restart required.
   */
  cpuBudgetPercent?: number;
  /** Lazy-load session messages on demand instead of full DB hydrate at startup. Default true. */
  lazyStorageCache?: boolean;
  /** Max parallel CPU-bound background tasks. Derived from cpuBudgetPercent when unset. */
  backgroundConcurrency?: number;
}

export interface ResolvedRuntimeSettings {
  cpuBudgetPercent: number;
  lazyStorageCache: boolean;
  backgroundConcurrency: number;
  onnxIntraOpThreads: number;
  onnxInterOpThreads: number;
}

const DEFAULT_CPU_BUDGET = 40;

export function resolveRuntimeSettings(
  settings?: RuntimeSettings | null,
  cpuCount = cpus().length,
): ResolvedRuntimeSettings {
  const cpuBudgetPercent = clamp(
    settings?.cpuBudgetPercent ?? DEFAULT_CPU_BUDGET,
    10,
    80,
  );
  const lazyStorageCache = settings?.lazyStorageCache !== false;
  const cores = Math.max(1, cpuCount);

  // Map budget to ONNX threads: stay conservative on single-core budget (≤50% → 1 thread).
  const onnxIntraOpThreads = cpuBudgetPercent <= 50
    ? 1
    : Math.min(2, Math.max(1, Math.round((cpuBudgetPercent / 100) * cores)));
  const onnxInterOpThreads = 1;

  const derivedConcurrency = Math.max(
    1,
    Math.min(4, Math.round((cpuBudgetPercent / 100) * cores)),
  );
  const backgroundConcurrency = settings?.backgroundConcurrency
    ? clamp(settings.backgroundConcurrency, 1, 8)
    : derivedConcurrency;

  return {
    cpuBudgetPercent,
    lazyStorageCache,
    backgroundConcurrency,
    onnxIntraOpThreads,
    onnxInterOpThreads,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
