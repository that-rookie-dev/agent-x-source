import type { CatalogManifest } from '@agentx/shared';

export function catalogNeedsManifestSync(
  count: number,
  storedRevision: number,
  manifest: CatalogManifest,
): boolean {
  const expected = manifest.crews.length;
  return count !== expected || storedRevision < manifest.revision;
}

export function manifestCatalogIds(manifest: CatalogManifest): Set<string> {
  return new Set(manifest.crews.map((crew) => crew.id));
}

type SqliteDb = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => Array<Record<string, unknown>>;
  };
};

/** Remove hub catalog rows (and FTS rows) that are no longer in the bundled manifest. */
export function pruneSqliteCatalogOrphans(
  db: SqliteDb,
  manifest: CatalogManifest,
): { removed: number } {
  const validIds = manifestCatalogIds(manifest);
  const rows = db.prepare(`SELECT id FROM crew_catalog`).all();
  const ftsDelete = db.prepare(`DELETE FROM crew_catalog_fts WHERE catalog_id = ?`);
  const rowDelete = db.prepare(`DELETE FROM crew_catalog WHERE id = ?`);
  let removed = 0;
  for (const row of rows) {
    const id = row['id'] as string;
    if (validIds.has(id)) continue;
    ftsDelete.run(id);
    rowDelete.run(id);
    removed += 1;
  }
  return { removed };
}

/** Remove duplicate active titles, keeping the manifest-backed row when present. */
export function dedupeSqliteCatalogTitles(
  db: SqliteDb,
  manifest: CatalogManifest,
): { removed: number } {
  const validIds = manifestCatalogIds(manifest);
  const rows = db.prepare(`
    SELECT id, lower(trim(title)) as title_key, hub_revision
    FROM crew_catalog
    ORDER BY title_key, hub_revision DESC, id
  `).all();
  const ftsDelete = db.prepare(`DELETE FROM crew_catalog_fts WHERE catalog_id = ?`);
  const rowDelete = db.prepare(`DELETE FROM crew_catalog WHERE id = ?`);
  const seen = new Map<string, string>();
  let removed = 0;
  for (const row of rows) {
    const id = row['id'] as string;
    const key = row['title_key'] as string;
    if (!key) continue;
    const keeper = seen.get(key);
    if (!keeper) {
      seen.set(key, id);
      continue;
    }
    const keepManifest = validIds.has(id) && !validIds.has(keeper);
    if (keepManifest) {
      ftsDelete.run(keeper);
      rowDelete.run(keeper);
      seen.set(key, id);
      removed += 1;
      continue;
    }
    ftsDelete.run(id);
    rowDelete.run(id);
    removed += 1;
  }
  return { removed };
}

export async function prunePgCatalogOrphans(
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  manifest: CatalogManifest,
): Promise<{ removed: number }> {
  const validIds = manifestCatalogIds(manifest);
  const res = await pool.query(`SELECT id FROM crew_catalog`);
  let removed = 0;
  for (const row of res.rows) {
    const id = row['id'] as string;
    if (validIds.has(id)) continue;
    await pool.query(`DELETE FROM crew_catalog WHERE id = $1`, [id]);
    removed += 1;
  }
  return { removed };
}

export async function dedupePgCatalogTitles(
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  manifest: CatalogManifest,
): Promise<{ removed: number }> {
  const validIds = manifestCatalogIds(manifest);
  const res = await pool.query(`
    SELECT id, lower(trim(title)) as title_key, hub_revision
    FROM crew_catalog
    ORDER BY title_key, hub_revision DESC, id
  `);
  const seen = new Map<string, string>();
  let removed = 0;
  for (const row of res.rows) {
    const id = row['id'] as string;
    const key = row['title_key'] as string;
    if (!key) continue;
    const keeper = seen.get(key);
    if (!keeper) {
      seen.set(key, id);
      continue;
    }
    const keepManifest = validIds.has(id) && !validIds.has(keeper);
    const dropId = keepManifest ? keeper : id;
    if (keepManifest) seen.set(key, id);
    await pool.query(`DELETE FROM crew_catalog WHERE id = $1`, [dropId]);
    removed += 1;
  }
  return { removed };
}
