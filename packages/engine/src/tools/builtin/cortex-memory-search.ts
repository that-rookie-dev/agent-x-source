import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { resolveMemoryFabricSearchSessionFilter } from '@agentx/shared';
import { getMemoryFabricInstance, type MemoryNode } from '../../neural/MemoryFabric.js';
import { getEmbedderInstance } from '../../neural/OnnxEmbeddingProvider.js';
import { CHAT_MEMORY_TAG } from '../../neural/ChatTurnMemoryIngester.js';
import { USER_PROFILE_TAG } from '../../neural/UserChatMemoryIngester.js';
import {
  getRetrievalSettings,
  applyScoreGate,
  heuristicRerank,
  toEvidenceUnit,
  packEvidenceBlocks,
  EMPTY_EVIDENCE_MARKER,
  type EvidenceUnit,
} from '../../neural/retrieval/index.js';
import { knowledgeBaseSearch } from './knowledge-base-search.js';

type CortexScope = 'session' | 'profile' | 'both';

function parseScope(raw: unknown): CortexScope {
  if (raw === 'session' || raw === 'profile' || raw === 'both') return raw;
  return 'both';
}

async function retrieve(
  fabric: NonNullable<ReturnType<typeof getMemoryFabricInstance>>,
  embedding: number[],
  query: string,
  opts: { limit: number; tag?: string; sessionId?: string | null },
): Promise<MemoryNode[]> {
  const settings = getRetrievalSettings();
  const overFetch = Math.max(opts.limit, settings.vectorOverFetch);
  const raw = settings.hybridEnabled
    ? await fabric.hybridSearch(embedding, query, {
        limit: overFetch,
        tag: opts.tag,
        sessionId: opts.sessionId,
        vectorLimit: overFetch,
        lexicalLimit: overFetch,
      })
    : await fabric.vectorSearch(embedding, {
        limit: overFetch,
        tag: opts.tag,
        sessionId: opts.sessionId,
      });
  let next = applyScoreGate(raw, {
    minScore: settings.minScoreMemory,
    maxPerSource: settings.maxChunksPerSource,
  });
  if (settings.rerankEnabled) next = heuristicRerank(query, next);
  return next.slice(0, opts.limit);
}

/**
 * Vector/hybrid search over Neural Cortex chat/profile memory (gated + citeable).
 */
export async function cortexMemorySearch(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const query = (args['query'] as string) ?? '';
  if (!query.trim()) return { success: false, output: 'query is required', error: 'INVALID_ARGS' };

  const fabric = getMemoryFabricInstance();
  const embedder = getEmbedderInstance();
  if (!fabric || !embedder) {
    return knowledgeBaseSearch(args, context);
  }

  const settings = getRetrievalSettings();
  const topK = typeof args['limit'] === 'number' ? Math.min(Math.max(1, args['limit']), 20) : 8;
  const scope = parseScope(args['scope']);
  const sessionFilter = resolveMemoryFabricSearchSessionFilter(context.sessionId, context.contextKind);
  const isSuper = sessionFilter === null;

  try {
    const embedding = await embedder.embed(query);
    const collected: MemoryNode[] = [];
    let candidatesIn = 0;

    if (scope === 'session' || scope === 'both') {
      const chatNodes = await retrieve(fabric, embedding, query, {
        limit: topK,
        tag: CHAT_MEMORY_TAG,
        sessionId: sessionFilter,
      });
      candidatesIn += chatNodes.length;
      collected.push(...chatNodes);

      if (!isSuper && scope === 'session') {
        const sessionNodes = await retrieve(fabric, embedding, query, {
          limit: topK,
          sessionId: sessionFilter,
        });
        const extra = sessionNodes.filter((n) => n.tag !== CHAT_MEMORY_TAG && n.tag !== USER_PROFILE_TAG);
        candidatesIn += extra.length;
        collected.push(...extra.slice(0, topK));
      }
    }

    if ((scope === 'profile' || scope === 'both') && isSuper) {
      const profileNodes = await retrieve(fabric, embedding, query, {
        limit: Math.max(3, Math.floor(topK / 2)),
        tag: USER_PROFILE_TAG,
        sessionId: null,
      });
      candidatesIn += profileNodes.length;
      collected.push(...profileNodes);
    }

    const seen = new Set<string>();
    const units: EvidenceUnit[] = [];
    for (let i = 0; i < collected.length; i++) {
      const n = collected[i]!;
      if (!n.id || seen.has(n.id)) continue;
      seen.add(n.id);
      const u = toEvidenceUnit(n, i);
      if (u) units.push(u);
    }

    if (units.length === 0) {
      return {
        success: true,
        output: EMPTY_EVIDENCE_MARKER,
        metadata: { count: 0 },
      };
    }

    const packed = packEvidenceBlocks(units, {
      maxChars: settings.maxEvidenceCharsCompact,
      maxLineChars: settings.maxEvidenceLineChars,
      logLabel: 'cortex_memory_search',
      candidatesIn,
    });

    return {
      success: true,
      output: `Cortex memory matches (${packed.count}). Cite [E#] when using these facts.\n\n${packed.text}`,
      metadata: { count: packed.count, evidenceIds: packed.evidenceIds },
    };
  } catch (e) {
    return {
      success: false,
      output: `Cortex memory search failed: ${e instanceof Error ? e.message : String(e)}`,
      error: 'CORTEX_ERROR',
    };
  }
}
