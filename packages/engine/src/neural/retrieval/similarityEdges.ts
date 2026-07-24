/**
 * Optional post-ingest semantic similarity edges (Phase 11).
 * Async / best-effort — must not block document ingest.
 */

import type { MemoryFabric, MemoryNode } from '../MemoryFabric.js';
import { getRetrievalSettings } from './settings.js';

/** Exported for unit tests. */
export function nearDuplicate(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
  const nb = b.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
  return na === nb || (na.length > 40 && nb.includes(na.slice(0, 40)));
}

/**
 * For each new chunk, ANN-query similar active chunks and bind RELATED_TO when
 * score ≥ threshold and not order-adjacent. Caps degree per node.
 */
export async function linkSimilarChunks(
  fabric: MemoryFabric,
  chunks: Array<{
    id: string;
    content: string;
    embedding?: number[];
    sourceId?: string;
    provenance?: { index?: number };
  }>,
): Promise<{ linked: number; skipped: number }> {
  const settings = getRetrievalSettings();
  const minScore = settings.similarityEdgeMinScore;
  const maxDegree = settings.similarityEdgeMaxDegree;
  let linked = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    if (!chunk.embedding?.length || !chunk.id) {
      skipped++;
      continue;
    }
    let neighbors: MemoryNode[] = [];
    try {
      neighbors = await fabric.vectorSearch(chunk.embedding, {
        limit: maxDegree + 4,
        category: 'source_doc',
      });
    } catch {
      skipped++;
      continue;
    }

    let degree = 0;
    for (const n of neighbors) {
      if (!n.id || n.id === chunk.id) continue;
      if (n.unitType === 'hub') continue;
      const score = n.distance != null ? 1 - n.distance : 0;
      if (score < minScore) continue;
      if (nearDuplicate(chunk.content, n.content)) {
        skipped++;
        continue;
      }
      // Skip likely order-adjacent same-source sequential chunks (index ±1).
      const aIdx = Number(chunk.provenance?.index);
      const bIdx = Number(n.provenance?.['index']);
      if (
        chunk.sourceId && n.sourceId === chunk.sourceId
        && Number.isFinite(aIdx) && Number.isFinite(bIdx)
        && Math.abs(aIdx - bIdx) <= 1
      ) {
        skipped++;
        continue;
      }
      try {
        await fabric.bindEdge({
          sourceNodeId: chunk.id,
          targetNodeId: n.id,
          relationshipType: 'RELATED_TO',
          weight: score,
          extractionMethod: 'INFERRED',
        });
        linked++;
        degree++;
        if (degree >= maxDegree) break;
      } catch {
        skipped++;
      }
    }
  }

  return { linked, skipped };
}
