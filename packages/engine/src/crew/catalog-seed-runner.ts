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

export async function runCatalogSeed(
  store: CrewCatalogStore,
  onProgress?: (line: string) => void,
): Promise<void> {
  const manifest = loadCatalogManifest();
  if (!manifest) {
    return;
  }

  const storedRev = await store.getCatalogRevision();
  const seededCount = await store.getCatalogCount();
  const expectedCount = manifest.crews.length;

  if (!catalogNeedsManifestSync(seededCount, storedRev, manifest)) {
    markCatalogSeedReady(seededCount, manifest.revision);
    onProgress?.(`Crew Hub seed data found (revision ${storedRev}, ${seededCount} crews).`);
    return;
  }

  markCatalogSeedStarted(expectedCount, manifest.revision);
  onProgress?.(
    `Crew Hub catalog needs sync (stored r${storedRev} → r${manifest.revision}, ${seededCount}/${expectedCount} crews) — seeding…`,
  );
  try {
    const result = await store.seedCatalog(manifest, (processed, total) => {
      const pct = total > 0 ? Math.round((processed / total) * 100) : 100;
      onProgress?.(`Crew Hub catalog: ${processed}/${total} crews (${pct}%)`);
    });
    const finalCount = await store.getCatalogCount();
    markCatalogSeedReady(finalCount, manifest.revision);
    onProgress?.(`Crew Hub catalog ready — ${finalCount} crews (${result.inserted} new, ${result.updated} updated).`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    markCatalogSeedError(message);
    onProgress?.(`[ERROR] Crew Hub catalog seed failed: ${message}`);
    throw e;
  }
}

/** Start hub catalog seed in the background (idempotent). */
export function startBackgroundCatalogSeed(
  store: CrewCatalogStore,
  onProgress?: (line: string) => void,
): void {
  if (getCatalogSeedInflight()) return;
  const promise = runCatalogSeed(store, onProgress).catch(() => { /* surfaced via seed state */ });
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
