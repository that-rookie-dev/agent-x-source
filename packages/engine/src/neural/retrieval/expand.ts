/**
 * Controlled depth-1 graph expansion for retrieval hits.
 * Order edges (FOLLOWS / legacy NEXT_STEP) ≠ semantic RELATED_TO.
 */

import type { MemoryEdgeType, MemoryFabric, MemoryNode } from '../MemoryFabric.js';
import { getRetrievalSettings } from './settings.js';
import { applyScoreGate } from './scoreGate.js';

const ORDER_EDGE_TYPES: MemoryEdgeType[] = ['FOLLOWS', 'PRECEDES', 'NEXT_STEP'];
const SEMANTIC_EDGE_TYPES: MemoryEdgeType[] = ['RELATED_TO', 'SYNONYM', 'REFERENCES', 'MENTIONS'];

export type ExpandMode = 'order' | 'semantic' | 'both';

/**
 * Expand top hits by one hop. Re-scores neighbors with min-score; never pulls whole docs.
 */
export async function expandEvidenceNeighborhood(
  fabric: MemoryFabric,
  hits: MemoryNode[],
  opts?: {
    mode?: ExpandMode;
    minScore?: number;
  },
): Promise<MemoryNode[]> {
  const settings = getRetrievalSettings();
  const mode = opts?.mode ?? (settings.useOrderEdgesForExpand ? 'order' : 'semantic');
  const topN = Math.min(settings.graphExpandOnlyOnTopHits, hits.length);
  if (topN === 0) return hits;

  const startIds = hits
    .slice(0, topN)
    .map((h) => h.id)
    .filter((id): id is string => !!id);
  if (!startIds.length) return hits;

  const relTypes: MemoryEdgeType[] =
    mode === 'order'
      ? ORDER_EDGE_TYPES
      : mode === 'semantic'
        ? SEMANTIC_EDGE_TYPES
        : [...ORDER_EDGE_TYPES, ...SEMANTIC_EDGE_TYPES];

  const walk = await fabric.graphWalk({
    startNodeIds: startIds,
    maxDepth: settings.graphExpandDepth,
    maxFanOut: 2,
    minWeight: 0.2,
    relationshipTypes: relTypes,
  });

  const hitIds = new Set(hits.map((h) => h.id).filter(Boolean) as string[]);
  const neighborIds = walk.nodeIds.filter((id) => !hitIds.has(id)).slice(0, topN * 2);
  if (!neighborIds.length) return hits;

  const neighbors = await fabric.getNodesByIds(neighborIds);
  const gated = applyScoreGate(
    neighbors.map((n) => ({
      ...n,
      // Neighbors often lack distance; treat as mid confidence so minScore can still drop junk.
      score: n.distance != null ? 1 - n.distance : Math.max(opts?.minScore ?? settings.minScoreMemory, 0.5),
    })),
    { minScore: opts?.minScore ?? Math.min(settings.minScoreMemory, settings.minScoreKb) * 0.85 },
  );

  const seen = new Set(hitIds);
  const out = [...hits];
  for (const n of gated) {
    if (!n.id || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}
