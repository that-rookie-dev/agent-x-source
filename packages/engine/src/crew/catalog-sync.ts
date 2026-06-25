import type { CrewCatalogStore } from './CrewSuggestionService.js';
import { awaitCatalogSeed, startBackgroundCatalogSeed } from './catalog-seed-runner.js';

/** Seed empty catalog or upsert when hub manifest revision advances. */
export async function syncCatalogFromManifest(store: CrewCatalogStore): Promise<void> {
  startBackgroundCatalogSeed(store);
  await awaitCatalogSeed();
}
