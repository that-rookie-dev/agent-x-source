import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCatalogManifest } from '../src/crew/catalog-manifest.js';
import {
  catalogNeedsManifestSync,
  dedupeSqliteCatalogTitles,
  pruneSqliteCatalogOrphans,
} from '../src/crew/catalog-prune.js';
import { healDatabaseStore } from '../src/db/database-healer.js';
import { SessionStore } from '../src/session/SessionStore.js';

const manifest = loadCatalogManifest();

/** Full hub manifest seed/heal can exceed 5s on CI runners. */
const CATALOG_SEED_TIMEOUT_MS = 30_000;

function isSqliteStore(store: SessionStore): boolean {
  return !(store as unknown as { memMode: boolean }).memMode && !!(store as unknown as { db: unknown }).db;
}

describe('catalog-prune', () => {
  it.skipIf(!manifest)('catalogNeedsManifestSync when count exceeds manifest', () => {
    expect(catalogNeedsManifestSync(manifest!.crews.length + 51, manifest!.revision, manifest!)).toBe(true);
    expect(catalogNeedsManifestSync(manifest!.crews.length, manifest!.revision, manifest!)).toBe(false);
    expect(catalogNeedsManifestSync(manifest!.crews.length, manifest!.revision - 1, manifest!)).toBe(true);
  });

  it.skipIf(!manifest)('pruneSqliteCatalogOrphans removes stale hub rows', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentx-prune-test-'));
    const store = new SessionStore(join(tempDir, 'test.db'));
    if (!isSqliteStore(store)) return;
    try {
      const catalogStore = store.getCrewCatalogStore();
      await catalogStore.seedCatalog(manifest!);
      const db = store.getDb() as Parameters<typeof runSqliteCrewCatalogMigration>[0];
      const before = db.prepare(`SELECT COUNT(*) as c FROM crew_catalog`).get() as { c: number };
      db.prepare(`
        INSERT INTO crew_catalog (
          id, callsign, name, title, category_id, category_label, description,
          system_prompt, search_text, hub_revision, active
        ) VALUES ('hub-stale_orphan', 'stale_orphan', 'Stale Orphan', 'Stale Role', 'backend-engineering',
          'Backend Engineering', 'stale', 'stale', 'stale orphan', 1, 1)
      `).run();
      db.prepare(`INSERT INTO crew_catalog_fts(catalog_id, search_text) VALUES ('hub-stale_orphan', 'stale orphan')`).run();
      const withOrphan = db.prepare(`SELECT COUNT(*) as c FROM crew_catalog`).get() as { c: number };
      expect(withOrphan.c).toBe(before.c + 1);

      const { removed } = pruneSqliteCatalogOrphans(db, manifest!);
      expect(removed).toBe(1);
      const after = db.prepare(`SELECT COUNT(*) as c FROM crew_catalog`).get() as { c: number };
      expect(after.c).toBe(manifest!.crews.length);
      const fts = db.prepare(`SELECT COUNT(*) as c FROM crew_catalog_fts WHERE catalog_id = 'hub-stale_orphan'`).get() as { c: number };
      expect(fts.c).toBe(0);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, CATALOG_SEED_TIMEOUT_MS);

  it.skipIf(!manifest)('dedupeSqliteCatalogTitles keeps manifest row', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentx-dedupe-test-'));
    const store = new SessionStore(join(tempDir, 'test.db'));
    if (!isSqliteStore(store)) return;
    try {
      const catalogStore = store.getCrewCatalogStore();
      await catalogStore.seedCatalog(manifest!);
      const db = store.getDb() as Parameters<typeof runSqliteCrewCatalogMigration>[0];
      const sample = manifest!.crews[0]!;
      db.prepare(`
        INSERT INTO crew_catalog (
          id, callsign, name, title, category_id, category_label, description,
          system_prompt, search_text, hub_revision, active
        ) VALUES ('hub-dup_title_test', 'dup_title_test', 'Dup Name', ?, 'backend-engineering',
          'Backend Engineering', 'dup', 'dup', 'dup title', 1, 1)
      `).run(sample.title);
      db.prepare(`INSERT INTO crew_catalog_fts(catalog_id, search_text) VALUES ('hub-dup_title_test', 'dup title')`).run();

      const { removed } = dedupeSqliteCatalogTitles(db, manifest!);
      expect(removed).toBe(1);
      const kept = db.prepare(`SELECT id FROM crew_catalog WHERE lower(trim(title)) = lower(trim(?))`).all(sample.title) as Array<{ id: string }>;
      expect(kept).toHaveLength(1);
      expect(kept[0]!.id).toBe(sample.id);
      expect(db.prepare(`SELECT COUNT(*) as c FROM crew_catalog`).get()).toEqual({ c: manifest!.crews.length });
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, CATALOG_SEED_TIMEOUT_MS);

  it.skipIf(!manifest)('healDatabaseStore prunes when catalog count exceeds manifest', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agentx-heal-prune-'));
    const store = new SessionStore(join(tempDir, 'test.db'));
    if (!isSqliteStore(store)) return;
    try {
      const catalogStore = store.getCrewCatalogStore();
      await catalogStore.seedCatalog(manifest!);
      const db = store.getDb() as Parameters<typeof runSqliteCrewCatalogMigration>[0];
      db.prepare(`
        INSERT INTO crew_catalog (
          id, callsign, name, title, category_id, category_label, description,
          system_prompt, search_text, hub_revision, active
        ) VALUES ('hub-heal_orphan', 'heal_orphan', 'Heal Orphan', 'Heal Orphan Role', 'backend-engineering',
          'Backend Engineering', 'orphan', 'orphan', 'heal orphan', 1, 1)
      `).run();

      const result = await healDatabaseStore(store);
      expect(result.catalogSynced).toBe(true);
      expect(result.catalogCount).toBe(manifest!.crews.length);
      expect(result.expectedCatalogCount).toBe(manifest!.crews.length);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, CATALOG_SEED_TIMEOUT_MS);
});
