/**
 * Precision gates: min-score, dedupe, per-source diversity.
 */

export function similarityFromDistance(distance: number | null | undefined): number | null {
  if (distance == null || !Number.isFinite(distance)) return null;
  return Math.max(0, Math.min(1, 1 - distance));
}

export interface ScoredItem {
  id?: string;
  content: string;
  sourceId?: string | null;
  distance?: number | null;
  score?: number | null;
}

/**
 * Resolve a gate-able similarity in [0, 1].
 *
 * - Vector `distance` → cosine similarity.
 * - `score` is only trusted when already cosine-like (0, 1]; raw ts_rank
 *   (~0.01–0.2) and term-counts (>1) must not override a good vector hit,
 *   and must not alone pass minScoreKb.
 * - When both exist, take the max so a real FTS hit (e.g. 0.55) can still
 *   survive a weak embedding match.
 */
export function itemSimilarity(item: ScoredItem): number {
  const fromDist = similarityFromDistance(item.distance);
  const raw = item.score;
  const score = raw != null && Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : null;
  if (fromDist != null && score != null) return Math.max(fromDist, score);
  if (fromDist != null) return fromDist;
  if (score != null) return score;
  return 0;
}

export function filterByMinScore<T extends ScoredItem>(items: T[], minScore: number): T[] {
  if (minScore <= 0) return items;
  return items.filter((item) => itemSimilarity(item) >= minScore);
}

function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400);
}

/** Drop near-duplicate bodies (keeps first / higher-ranked). */
export function dedupeByContent<T extends ScoredItem>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = normalizeForDedupe(item.content || '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Cap how many chunks from the same sourceId survive. */
export function diversifyBySource<T extends ScoredItem>(items: T[], maxPerSource: number): T[] {
  if (maxPerSource <= 0) return items;
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const sid = item.sourceId ?? '';
    if (!sid) {
      out.push(item);
      continue;
    }
    const n = counts.get(sid) ?? 0;
    if (n >= maxPerSource) continue;
    counts.set(sid, n + 1);
    out.push(item);
  }
  return out;
}

/** Full precision pipeline after retrieve / before pack. */
export function applyScoreGate<T extends ScoredItem>(
  items: T[],
  opts: { minScore: number; maxPerSource?: number },
): T[] {
  let next = filterByMinScore(items, opts.minScore);
  next = dedupeByContent(next);
  if (opts.maxPerSource != null) {
    next = diversifyBySource(next, opts.maxPerSource);
  }
  return next;
}
