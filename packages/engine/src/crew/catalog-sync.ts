import type { CrewCatalogStore } from './CrewSuggestionService.js';
import { awaitCatalogSeed, runCatalogSeed, startBackgroundCatalogSeed } from './catalog-seed-runner.js';

/** Seed empty catalog or upsert when hub manifest revision advances. */
export async function syncCatalogFromManifest(
  store: CrewCatalogStore,
  onProgress?: (line: string) => void,
): Promise<void> {
  // Setup wizard provision streams progress over SSE — must not await a stale background job.
  if (onProgress) {
    await runCatalogSeed(store, onProgress);
    return;
  }
  startBackgroundCatalogSeed(store, onProgress);
  await awaitCatalogSeed();
}
