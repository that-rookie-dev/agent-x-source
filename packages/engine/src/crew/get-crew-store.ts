import type { CrewCatalogStore } from './CrewSuggestionService.js';
import { CrewSuggestionService } from './CrewSuggestionService.js';

type StoreLike = {
  getCrewCatalogStore?: () => CrewCatalogStore;
};

/** Resolve crew catalog store from PostgresStorageAdapter. */
export function getCrewCatalogStoreFromEngine(store: unknown): CrewCatalogStore | null {
  if (!store || typeof store !== 'object') return null;
  const s = store as StoreLike;
  if (typeof s.getCrewCatalogStore === 'function') {
    return s.getCrewCatalogStore();
  }
  return null;
}

export function getCrewSuggestionService(store: unknown): CrewSuggestionService | null {
  const catalogStore = getCrewCatalogStoreFromEngine(store);
  if (!catalogStore) return null;
  return new CrewSuggestionService(catalogStore);
}
