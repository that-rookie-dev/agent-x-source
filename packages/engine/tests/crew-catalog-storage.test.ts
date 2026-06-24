import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '../src/session/SessionStore.js';
import { loadCatalogManifest } from '../src/crew/catalog-manifest.js';
import { buildPostgresTsQuery, buildSqliteFtsMatch, buildSqliteHubFtsMatch, buildPostgresHubTsQuery, tokenizeFtsQuery } from '../src/crew/fts-query.js';
import { syncCatalogFromManifest } from '../src/crew/catalog-sync.js';
import { runSqliteCrewCatalogMigration } from '../src/crew/sqlite-crew-catalog.js';
import { healDatabaseStore } from '../src/db/database-healer.js';

const manifest = loadCatalogManifest();

function isSqliteStore(store: SessionStore): boolean {
  return !(store as unknown as { memMode: boolean }).memMode;
}

describe('fts-query parity', () => {
  it('tokenizes query words consistently', () => {
    const words = tokenizeFtsQuery('Help with income tax return filing!');
    expect(words).toContain('income');
    expect(words).toContain('tax');
    expect(words).not.toContain('me');
  });

  it('uses OR semantics for SQLite and Postgres', () => {
    const query = 'tax planning strategy';
    const sqlite = buildSqliteFtsMatch(query);
    const pg = buildPostgresTsQuery(query);
    expect(sqlite).toContain(' OR ');
    expect(pg).toContain(' | ');
    expect(sqlite.split(' OR ').length).toBe(pg.split(' | ').length);
  });

  it('hub prefix match supports partial keywords', () => {
    const sqlite = buildSqliteHubFtsMatch('cardio');
    const pg = buildPostgresHubTsQuery('cardio');
    expect(sqlite).toContain('"cardio"*');
    expect(pg).toContain('cardio:*');
  });
});

describe('crew catalog storage', () => {
  let store: SessionStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-catalog-test-'));
    store = new SessionStore(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.skipIf(!manifest)('manifest ships with full hub catalog', () => {
    expect(manifest!.crews.length).toBeGreaterThan(900);
    expect(manifest!.revision).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!manifest)('seedCatalog persists searchable catalog entries', async () => {
    if (!isSqliteStore(store)) return;

    const catalogStore = store.getCrewCatalogStore();
    const seeded = await catalogStore.seedCatalog(manifest!);
    expect(seeded.inserted + seeded.updated).toBeGreaterThan(900);
    const sample = manifest!.crews[0]!;
    const entry = await catalogStore.getCatalogEntry(sample.id);
    expect(entry?.callsign).toBe(sample.callsign);
    const hits = await catalogStore.searchCatalog('income tax return filing help', 5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it.skipIf(!manifest)('repair ensures crew_catalog after manual table drop at schema v19', () => {
    if (!isSqliteStore(store)) return;

    const db = (store as unknown as { db: { exec: (sql: string) => void; prepare: (sql: string) => { get: () => unknown } } }).db;
    db.exec('DROP TABLE IF EXISTS crew_catalog');
    db.exec('DROP TABLE IF EXISTS crew_catalog_fts');
    db.exec('DROP TABLE IF EXISTS app_metadata');

    runSqliteCrewCatalogMigration(db);
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='crew_catalog'`).get();
    expect(row).toBeTruthy();
  });

  it.skipIf(!manifest)('syncCatalogFromManifest upserts when revision advances', async () => {
    if (!isSqliteStore(store)) return;

    const catalogStore = store.getCrewCatalogStore();
    await syncCatalogFromManifest(catalogStore);
    const bumped = { ...manifest!, revision: (manifest!.revision ?? 1) + 1 };
    const seeded = await catalogStore.seedCatalog(bumped);
    expect(seeded.inserted + seeded.updated).toBeGreaterThan(0);
    expect(await catalogStore.getCatalogRevision()).toBe(bumped.revision);
  });

  it.skipIf(!manifest)('searchCatalog matches partial hub keywords', async () => {
    if (!isSqliteStore(store)) return;

    const catalogStore = store.getCrewCatalogStore();
    await catalogStore.seedCatalog(manifest!);
    const partial = await catalogStore.searchCatalog('cardio', 10);
    expect(partial.length).toBeGreaterThan(0);
    const short = await catalogStore.searchCatalog('ta', 10);
    expect(short.length).toBeGreaterThan(0);
  });

  it.skipIf(!manifest)('healDatabaseStore recreates crew_catalog and re-seeds after drop', async () => {
    if (!isSqliteStore(store)) return;

    const db = (store as unknown as { db: { exec: (sql: string) => void } }).db;
    db.exec('DROP TABLE IF EXISTS crew_catalog');
    db.exec('DROP TABLE IF EXISTS crew_catalog_fts');
    db.exec('DELETE FROM app_metadata WHERE key = \'crew_catalog_revision\'');

    const result = await healDatabaseStore(store);
    expect(result.schemaRepaired).toBe(true);
    expect(result.catalogSynced).toBe(true);
    expect(result.catalogCount).toBeGreaterThanOrEqual(manifest!.crews.length);
  });
});
