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
