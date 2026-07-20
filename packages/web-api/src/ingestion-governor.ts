/**
 * Ingestion governor — retained for system visibility telemetry hooks.
 *
 * The RagStudio IngestionWorker is no longer started; pause/resume is a no-op.
 * App-visibility state is still tracked for `/api/system` callers.
 */

let appVisible = true;
let ragSourceCount = 0;
let neuralBrainEnabled = true;

/** @deprecated No-op — IngestionWorker is not started. */
export function bindIngestionWorker(_instance: unknown): void {
  /* intentionally empty */
}

export function setIngestionAppVisible(visible: boolean): void {
  appVisible = visible;
}

export function setIngestionNeuralBrainEnabled(enabled: boolean): void {
  neuralBrainEnabled = enabled;
}

/** @deprecated No longer queries ingestion_jobs; returns 0. */
export async function refreshIngestionRagSourceCount(_pool: unknown): Promise<number> {
  ragSourceCount = 0;
  return ragSourceCount;
}

/** @deprecated No-op — IngestionWorker is not started. */
export function evaluateIngestionWorker(): void {
  /* intentionally empty */
}

export function getIngestionGovernorState(): {
  appVisible: boolean;
  ragSourceCount: number;
  neuralBrainEnabled: boolean;
  shouldRun: boolean;
} {
  return {
    appVisible,
    ragSourceCount,
    neuralBrainEnabled,
    shouldRun: false,
  };
}
