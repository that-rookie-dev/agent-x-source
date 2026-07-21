/**
 * v1 heuristic rerank: vector score + lexical overlap + light provenance boosts.
 */

import { itemSimilarity, type ScoredItem } from './scoreGate.js';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((t) => t.length >= 2),
  );
}

function lexicalOverlap(query: string, content: string): number {
  const q = tokenize(query);
  if (q.size === 0) return 0;
  const c = tokenize(content);
  let hit = 0;
  for (const t of q) {
    if (c.has(t)) hit++;
  }
  return hit / q.size;
}

export interface Rerankable extends ScoredItem {
  label?: string;
  category?: string;
  provenance?: Record<string, unknown>;
}

/**
 * Rank candidates for a query. Higher is better.
 * Does not drop items — caller applies injectKeep / minScore separately.
 */
export function heuristicRerank<T extends Rerankable>(query: string, candidates: T[]): T[] {
  const q = query.trim();
  const scored = candidates.map((item) => {
    const sim = itemSimilarity(item);
    const lex = lexicalOverlap(q, `${item.label ?? ''} ${item.content}`);
    let boost = 0;
    const sourceName = String(item.provenance?.['sourceName'] ?? '');
    if (sourceName && q.toLowerCase().includes(sourceName.toLowerCase().slice(0, 24))) {
      boost += 0.05;
    }
    if (item.category === 'source_doc') boost += 0.02;
    const rankScore = sim * 0.65 + lex * 0.30 + boost;
    return { item, rankScore };
  });
  scored.sort((a, b) => b.rankScore - a.rankScore);
  return scored.map((s) => s.item);
}
