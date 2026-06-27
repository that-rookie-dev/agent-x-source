import type { CatalogEntry, CatalogManifest } from '@agentx/shared';

/** Merge FTS + substring hits, preserving FTS ranking order first. */
export function mergeCatalogSearchHits(
  ftsHits: Array<CatalogEntry & { ftsRank: number }>,
  likeHits: Array<CatalogEntry & { ftsRank: number }>,
  limit: number,
): Array<CatalogEntry & { ftsRank: number }> {
  const seen = new Set<string>();
  const merged: Array<CatalogEntry & { ftsRank: number }> = [];
  for (const hit of [...ftsHits, ...likeHits]) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
    if (merged.length >= limit) break;
  }
  return merged;
}

export function catalogLikePattern(query: string): string {
  return `%${query.trim().toLowerCase().slice(0, 80)}%`;
}

/** In-memory catalog search when Postgres is unavailable (mem mode). */
export function searchManifestCatalog(
  manifest: CatalogManifest,
  query: string,
  limit: number,
): Array<CatalogEntry & { ftsRank: number }> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const terms = trimmed.split(/\s+/).filter((t) => t.length > 1);
  const hits: Array<CatalogEntry & { ftsRank: number }> = [];
  for (const crew of manifest.crews) {
    const st = (crew.searchText ?? '').toLowerCase();
    let score = 0;
    if (st.includes(trimmed)) score += 0.6;
    for (const term of terms) {
      if (st.includes(term)) score += 0.12;
    }
    if (score > 0) {
      hits.push({ ...(crew as CatalogEntry), ftsRank: score });
    }
  }
  hits.sort((a, b) => b.ftsRank - a.ftsRank);
  return hits.slice(0, limit);
}
