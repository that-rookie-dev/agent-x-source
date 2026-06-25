import { catalogNeedsManifestSync } from './catalog-prune.js';
import { loadCatalogManifest } from './catalog-manifest.js';
import type { CrewCatalogStore } from './CrewSuggestionService.js';
import {
  buildCatalogSeedSnapshot,
  getCatalogSeedInflight,
  markCatalogSeedError,
  markCatalogSeedReady,
  markCatalogSeedStarted,
  setCatalogSeedInflight,
  type CatalogSeedSnapshot,
} from './catalog-seed-state.js';

async function runCatalogSeed(store: CrewCatalogStore): Promise<void> {
  const manifest = loadCatalogManifest();
  if (!manifest) {
    return;
  }

  const storedRev = await store.getCatalogRevision();
  const seededCount = await store.getCatalogCount();
  const expectedCount = manifest.crews.length;

  if (!catalogNeedsManifestSync(seededCount, storedRev, manifest)) {
    markCatalogSeedReady(seededCount, manifest.revision);
    return;
  }

  markCatalogSeedStarted(expectedCount, manifest.revision);
  try {
    await store.seedCatalog(manifest);
    const finalCount = await store.getCatalogCount();
    markCatalogSeedReady(finalCount, manifest.revision);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    markCatalogSeedError(message);
    throw e;
  }
}

/** Start hub catalog seed in the background (idempotent). */
export function startBackgroundCatalogSeed(store: CrewCatalogStore): void {
  if (getCatalogSeedInflight()) return;
  const promise = runCatalogSeed(store).catch(() => { /* surfaced via seed state */ });
  setCatalogSeedInflight(promise);
  void promise.finally(() => setCatalogSeedInflight(null));
}

/** Wait for an in-flight background seed, if any. */
export async function awaitCatalogSeed(): Promise<void> {
  const pending = getCatalogSeedInflight();
  if (pending) await pending;
}

export async function getCatalogSeedStatus(
  store: CrewCatalogStore,
  ftsBackend: CatalogSeedSnapshot['ftsTable'],
): Promise<CatalogSeedSnapshot> {
  const manifest = loadCatalogManifest();
  const expectedCount = manifest?.crews.length ?? 0;
  const manifestRevision = manifest?.revision ?? 0;
  const [seededCount, storedRevision] = await Promise.all([
    store.getCatalogCount(),
    store.getCatalogRevision(),
  ]);

  return buildCatalogSeedSnapshot({
    seededCount,
    expectedCount,
    manifestRevision,
    storedRevision,
    ftsBackend,
  });
}
