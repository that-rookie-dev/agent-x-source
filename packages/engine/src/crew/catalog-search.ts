import type { CatalogEntry } from '@agentx/shared';

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
