import type { EmbeddingProvider, KnowledgeSearchResult } from '@agentx/shared';
import type { MemoryFabric, MemoryNode } from '../neural/MemoryFabric.js';
import type { KnowledgeBaseSourceStore } from './KnowledgeBaseSourceStore.js';

function looksLikeIndexOrToc(content: string): boolean {
  const text = content.trim();
  if (text.length < 80) return false;
  if (/^(no extractable text)/i.test(text)) return true;
  const lower = text.toLowerCase();
  if (/\b(table of contents|contents|index of|list of hymns|abbreviations)\b/.test(lower)) {
    return true;
  }
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 6) return false;
  const dotted = lines.filter((l) => /\.{3,}\s*\d+\s*$/.test(l) || /\s+\d{1,4}\s*$/.test(l)).length;
  return dotted / lines.length >= 0.45;
}

function nodeToHit(node: MemoryNode, sourceName: string, kind: 'chunk' | 'page'): KnowledgeSearchResult {
  const prov = node.provenance ?? {};
  const score = node.distance != null ? Math.max(0, 1 - node.distance) : 0.5;
  return {
    id: node.id,
    content: node.content,
    sourceId: node.sourceId ?? '',
    sourceName,
    score,
    kind,
    metadata: {
      ...prov,
      sourceName,
      sourceId: node.sourceId,
      pageNumber: prov.pageNumber,
      index: prov.index,
    },
  };
}

async function loadSourceNodes(fabric: MemoryFabric, sourceId: string): Promise<MemoryNode[]> {
  const { nodes } = await fabric.getNodesBySource(sourceId, { limit: 5000, category: 'source_doc' });
  return nodes.filter((n) => n.unitType !== 'hub');
}

export async function searchKnowledgeBaseDocuments(
  fabric: MemoryFabric,
  embedder: EmbeddingProvider,
  sourceStore: KnowledgeBaseSourceStore,
  query: string,
  topK = 5,
  sourceId?: string,
): Promise<KnowledgeSearchResult[]> {
  const embedding = await embedder.embed(query);
  const vectorHits = await fabric.vectorSearch(embedding, {
    limit: Math.max(topK * 4, 20),
    category: 'source_doc',
  });

  let filtered = vectorHits.filter((n) => n.unitType === 'chunk' || !n.unitType);
  if (sourceId) {
    filtered = filtered.filter((n) => n.sourceId === sourceId);
  }

  const dense: KnowledgeSearchResult[] = [];
  const nameCache = new Map<string, string>();
  for (const node of filtered) {
    const sid = node.sourceId ?? '';
    if (!sid) continue;
    if (!nameCache.has(sid)) {
      const src = await sourceStore.getSource(sid);
      nameCache.set(sid, src?.name ?? sid);
    }
    dense.push(nodeToHit(node, nameCache.get(sid)!, 'chunk'));
  }

  return pageAwareRerank(dense, fabric, sourceStore, topK);
}

async function pageAwareRerank(
  dense: KnowledgeSearchResult[],
  fabric: MemoryFabric,
  sourceStore: KnowledgeBaseSourceStore,
  topK: number,
): Promise<KnowledgeSearchResult[]> {
  if (dense.length === 0) return [];

  const sourceIds = [...new Set(dense.map((r) => r.sourceId))];
  const nodesBySource = new Map<string, MemoryNode[]>();
  const names = new Map<string, string>();

  await Promise.all(
    sourceIds.map(async (sid) => {
      const src = await sourceStore.getSource(sid);
      names.set(sid, src?.name ?? sid);
      nodesBySource.set(sid, await loadSourceNodes(fabric, sid));
    }),
  );

  const chunksByIndex = new Map<string, Map<number, MemoryNode>>();
  const pagesByNumber = new Map<string, Map<number, MemoryNode>>();

  for (const [sid, nodes] of nodesBySource) {
    const chunkMap = new Map<number, MemoryNode>();
    const pageMap = new Map<number, MemoryNode>();
    for (const n of nodes) {
      const prov = n.provenance ?? {};
      if (n.unitType === 'page' && typeof prov.pageNumber === 'number') {
        pageMap.set(prov.pageNumber as number, n);
      }
      if (typeof prov.index === 'number') {
        chunkMap.set(prov.index as number, n);
      }
    }
    chunksByIndex.set(sid, chunkMap);
    pagesByNumber.set(sid, pageMap);
  }

  const scored = new Map<string, { result: KnowledgeSearchResult; score: number }>();
  const rrfK = 60;

  const add = (r: KnowledgeSearchResult, score: number) => {
    const existing = scored.get(r.id);
    if (existing) {
      existing.score += score;
      if (r.score > existing.result.score) existing.result = r;
    } else {
      scored.set(r.id, { result: { ...r, sourceName: names.get(r.sourceId) ?? r.sourceName }, score });
    }
  };

  for (const [rank, hit] of dense.entries()) {
    const denseScore = 1 / (rrfK + rank);
    add(hit, denseScore);

    const pageNumber = hit.metadata?.pageNumber as number | undefined;
    const chunkIndex = hit.metadata?.index as number | undefined;
    if (pageNumber == null || chunkIndex == null) continue;

    const pageMap = pagesByNumber.get(hit.sourceId);
    const pageNode = pageMap?.get(pageNumber);
    if (pageNode) {
      add(nodeToHit(pageNode, names.get(hit.sourceId) ?? hit.sourceName, 'page'), denseScore * 0.7);
    }

    const chunkMap = chunksByIndex.get(hit.sourceId);
    if (chunkMap) {
      for (const delta of [-1, 1]) {
        const neighbor = chunkMap.get(chunkIndex + delta);
        if (neighbor) {
          add(nodeToHit(neighbor, names.get(hit.sourceId) ?? hit.sourceName, 'chunk'), denseScore * 0.5);
        }
      }
    }
  }

  return [...scored.values()]
    .map((s) => {
      const penalty = looksLikeIndexOrToc(s.result.content) ? 0.55 : 1;
      return { result: s.result, score: s.score * penalty };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      ...s.result,
      sourceName: s.result.sourceName?.trim()
        ? s.result.sourceName
        : (names.get(s.result.sourceId) ?? s.result.sourceId),
    }));
}
