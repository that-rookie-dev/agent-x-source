/**
 * Hybrid retrieval: reciprocal rank fusion of vector + lexical candidates.
 */

import type { ScoredItem } from './scoreGate.js';

const RRF_K = 60;

export interface RankedCandidate extends ScoredItem {
  id: string;
  rrfScore?: number;
  vectorRank?: number;
  lexicalRank?: number;
}

/**
 * Merge two ranked lists via Reciprocal Rank Fusion.
 * Higher rrfScore is better. Preserves best-known similarity/distance from either list.
 */
export function mergeRrf<T extends RankedCandidate>(
  vectorHits: T[],
  lexicalHits: T[],
  opts?: { k?: number; limit?: number },
): T[] {
  const k = opts?.k ?? RRF_K;
  const byId = new Map<string, T & { rrfScore: number }>();

  const add = (list: T[], kind: 'vector' | 'lexical') => {
    list.forEach((item, index) => {
      if (!item.id) return;
      const contrib = 1 / (k + index + 1);
      const prev = byId.get(item.id);
      if (!prev) {
        byId.set(item.id, {
          ...item,
          rrfScore: contrib,
          vectorRank: kind === 'vector' ? index + 1 : undefined,
          lexicalRank: kind === 'lexical' ? index + 1 : undefined,
        });
        return;
      }
      prev.rrfScore += contrib;
      if (kind === 'vector') prev.vectorRank = index + 1;
      if (kind === 'lexical') prev.lexicalRank = index + 1;
      // Prefer stronger vector similarity when available.
      if (item.distance != null && (prev.distance == null || item.distance < prev.distance)) {
        prev.distance = item.distance;
      }
      if (item.score != null && (prev.score == null || item.score > prev.score)) {
        prev.score = item.score;
      }
    });
  };

  add(vectorHits, 'vector');
  add(lexicalHits, 'lexical');

  const merged = [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore);
  const limit = opts?.limit;
  return (limit != null ? merged.slice(0, limit) : merged) as T[];
}
