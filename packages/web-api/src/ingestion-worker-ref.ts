/**
 * Legacy ingestion-worker hooks.
 *
 * The RagStudio IngestionWorker was never bootstrapped and has been removed from
 * the live product surface. Auth/provider code still calls refresh after login;
 * keep a no-op so those call sites stay harmless without enqueuing dead jobs.
 */

/** @deprecated No-op — IngestionWorker is not started. */
export function setIngestionWorkerRef(_worker: unknown): void {
  /* intentionally empty */
}

/** @deprecated Always null — IngestionWorker is not started. */
export function getIngestionWorker(): null {
  return null;
}

/** @deprecated No-op — IngestionWorker is not started. */
export async function refreshIngestionWorkerGenerator(): Promise<void> {
  /* intentionally empty */
}
