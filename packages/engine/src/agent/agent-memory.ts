/**
 * Memory extraction and web search ingestion helpers extracted from Agent.ts (REFACTOR-2).
 */
import { getLogger, isMemoryFabricSuperSession, resolveMemoryFabricWriteSessionId, type SessionContextKind, type EmbeddingProvider, type CompletionRequest } from '@agentx/shared';
import { ChatTurnMemoryIngester } from '../neural/ChatTurnMemoryIngester.js';
import { UserChatMemoryIngester } from '../neural/UserChatMemoryIngester.js';
import type { MemoryFabric, MemoryNode } from '../neural/MemoryFabric.js';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { vectorMemoryPrefetch } from '../neural/VectorMemoryPrefetch.js';
import {
  getRetrievalSettings,
  applyScoreGate,
  heuristicRerank,
  toEvidenceUnit,
  packEvidenceBlocks,
  EMPTY_EVIDENCE_MARKER,
  expandEvidenceNeighborhood,
  type EvidenceUnit,
} from '../neural/retrieval/index.js';

export interface MemoryContextContext {
  messages: Array<{ role: string; content: string | unknown }>;
  reformulateQuery(rawQuery: string): Promise<string>;
  sessionId: string;
  options: { contextKind?: SessionContextKind };
  memoryFabric: MemoryFabric | null;
  memoryEmbedder: EmbeddingProvider | null;
  usesCompactContext(): boolean;
  setMemoryContextNodeIds(ids: string[]): void;
}

function packNodes(
  nodes: MemoryNode[],
  maxChars: number,
  startIndex: number,
): { text: string; ids: string[]; nextIndex: number } {
  const units: EvidenceUnit[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const u = toEvidenceUnit(nodes[i]!, i);
    if (u) units.push(u);
  }
  const packed = packEvidenceBlocks(units, {
    maxChars,
    maxLineChars: getRetrievalSettings().maxEvidenceLineChars,
    startIndex,
  });
  return {
    text: packed.text,
    ids: packed.evidenceIds,
    nextIndex: startIndex + packed.count,
  };
}

/**
 * Build the memory context block for the system prompt (vector prefetch + grounded packer).
 */
export async function buildMemoryContext(ctx: MemoryContextContext): Promise<{ episodic: string; semantic: string; graph: string; community?: string }> {
  const fabric = ctx.memoryFabric;
  const embedder = ctx.memoryEmbedder;
  if (!fabric || !embedder) return { episodic: '', semantic: '', graph: '' };
  try {
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user');
    const rawQuery = typeof lastUser?.content === 'string' ? lastUser.content : '';
    if (!rawQuery) return { episodic: '', semantic: '', graph: '' };

    const query = await ctx.reformulateQuery(rawQuery);
    const memorySessionId = ctx.sessionId;
    const isSuper = isMemoryFabricSuperSession(memorySessionId, ctx.options.contextKind);

    const settings = getRetrievalSettings();
    const result = await vectorMemoryPrefetch(fabric, embedder, query, {
      sessionId: memorySessionId,
      isSuperSession: isSuper,
      vectorLimit: settings.vectorLimit,
      userProfileLimit: isSuper ? settings.userProfileLimit : 0,
      episodicLimit: settings.episodicLimit,
      minRelevance: settings.minScoreMemory,
    });

    // Reuse the same query embedding for KB chunk search (one embed per turn).
    let chunkNodes: MemoryNode[] = [];
    try {
      const overFetch = Math.max(settings.kbChunkLimit, settings.vectorOverFetch);
      const chunkRaw = settings.hybridEnabled
        ? await fabric.hybridSearch(result.queryEmbedding, query, {
            limit: overFetch,
            category: 'source_doc',
            vectorLimit: overFetch,
            lexicalLimit: overFetch,
          })
        : await fabric.vectorSearch(result.queryEmbedding, {
            limit: overFetch,
            category: 'source_doc',
          });
      chunkNodes = applyScoreGate(chunkRaw, {
        minScore: settings.minScoreKb,
        maxPerSource: settings.maxChunksPerSource,
      });
      if (settings.rerankEnabled) {
        chunkNodes = heuristicRerank(query, chunkNodes);
      }
      chunkNodes = chunkNodes.slice(0, settings.rerankKeep);
      chunkNodes = await expandEvidenceNeighborhood(
        fabric,
        chunkNodes.slice(0, Math.min(settings.kbChunkLimit, settings.graphExpandOnlyOnTopHits)),
        {
          mode: 'order',
          minScore: settings.minScoreKb,
        },
      );
      chunkNodes = applyScoreGate(chunkNodes, {
        minScore: settings.minScoreKb,
        maxPerSource: settings.maxChunksPerSource,
      }).slice(0, Math.min(settings.kbChunkLimit, settings.injectKeep));
    } catch { /* best-effort */ }

    const allNodeIds = new Set(result.all.map((m) => m.id));
    for (const cn of chunkNodes) {
      if (cn.id && !allNodeIds.has(cn.id)) {
        result.vector.push(cn);
        result.all.push(cn);
        allNodeIds.add(cn.id);
      }
    }

    const MAX_CHARS = ctx.usesCompactContext()
      ? settings.maxEvidenceCharsCompact
      : settings.maxEvidenceCharsFull;

    let evidenceIndex = 1;
    const profilePack = packNodes(result.userProfile, Math.floor(MAX_CHARS * 0.30), evidenceIndex);
    evidenceIndex = profilePack.nextIndex;
    const episodicPack = packNodes(result.episodic, Math.floor(MAX_CHARS * 0.25), evidenceIndex);
    evidenceIndex = episodicPack.nextIndex;
    const semanticPack = packNodes(result.vector, Math.floor(MAX_CHARS * 0.45), evidenceIndex);

    const evidenceIds = [...profilePack.ids, ...episodicPack.ids, ...semanticPack.ids];
    ctx.setMemoryContextNodeIds(evidenceIds);

    const episodicCombined = [profilePack.text, episodicPack.text].filter(Boolean).join('\n');
    const semanticText = semanticPack.text;

    if (!episodicCombined && !semanticText) {
      getLogger().info('AGENT', 'buildMemoryContext: no evidence above confidence threshold');
      return {
        episodic: '',
        semantic: EMPTY_EVIDENCE_MARKER,
        graph: '',
      };
    }

    getLogger().info(
      'RETRIEVAL_PACK',
      'buildMemoryContext',
      {
        kept: evidenceIds.length,
        userProfile: result.userProfile.length,
        episodic: result.episodic.length,
        semantic: result.vector.length,
        chunks: chunkNodes.length,
        hybrid: settings.hybridEnabled,
        maxChars: MAX_CHARS,
      },
    );

    return {
      episodic: episodicCombined,
      semantic: semanticText,
      graph: '',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().warn('AGENT', `buildMemoryContext failed: ${msg}`);
    ctx.setMemoryContextNodeIds([]);
    return { episodic: '', semantic: '', graph: '' };
  }
}

export interface MemoryExtractionContext {
  config: { autoMemory?: boolean; provider: { activeModel: string } };
  provider: ProviderInterface;
  memoryFabric: MemoryFabric | null;
  memoryEmbedder: EmbeddingProvider | null;
  chatTurnMemoryIngester: ChatTurnMemoryIngester | null;
  setChatTurnMemoryIngester(i: ChatTurnMemoryIngester): void;
  userChatMemoryIngester: UserChatMemoryIngester | null;
  setUserChatMemoryIngester(i: UserChatMemoryIngester): void;
  sessionId: string;
  options: { contextKind?: SessionContextKind };
}

/**
 * Extract memorable facts from the exchange and persist them.
 * Runs asynchronously and silently — never blocks the main flow.
 */
export function extractMemories(
  ctx: MemoryExtractionContext,
  userMessage: string,
  assistantResponse: string,
): void {
  if (ctx.config.autoMemory === false) return;
  const fabric = ctx.memoryFabric;
  const embedder = ctx.memoryEmbedder;
  if (fabric && embedder) {
    let ingester = ctx.chatTurnMemoryIngester;
    if (!ingester) {
      ingester = new ChatTurnMemoryIngester(fabric, embedder);
      ctx.setChatTurnMemoryIngester(ingester);
    }
    const storageSessionId = resolveMemoryFabricWriteSessionId(ctx.sessionId, ctx.options.contextKind);
    void ingester.ingestTurn(
      userMessage,
      assistantResponse,
      ctx.sessionId,
      storageSessionId,
    ).catch(() => {});
  }
  if (!isMemoryFabricSuperSession(ctx.sessionId, ctx.options.contextKind)) return;
  if (!fabric || !embedder) return;
  let userIngester = ctx.userChatMemoryIngester;
  if (!userIngester) {
    userIngester = new UserChatMemoryIngester(
      fabric,
      embedder,
      ctx.provider,
      ctx.config.provider.activeModel,
    );
    ctx.setUserChatMemoryIngester(userIngester);
  }
  void userIngester.ingestTurn(userMessage, assistantResponse, ctx.sessionId).catch(() => {});
}

export interface ReformulateQueryContext {
  usesCompactContext(): boolean;
  messages: Array<{ role: string; content: string | unknown }>;
  config: { provider: { activeModel: string } };
  provider: ProviderInterface;
}

/**
 * Reformulate a user message into a standalone search query using conversation context.
 */
export async function reformulateQuery(ctx: ReformulateQueryContext, rawQuery: string): Promise<string> {
  const trimmed = rawQuery.trim();
  if (ctx.usesCompactContext()) {
    if (trimmed.length > 80) return trimmed;
    const recentUserMsgs = ctx.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
      .slice(-3)
      .map((m) => m.content as string);
    if (recentUserMsgs.length > 0 && trimmed.split(/\s+/).length <= 8) {
      return `${recentUserMsgs[recentUserMsgs.length - 1]} ${trimmed}`.trim().slice(0, 300);
    }
    return trimmed;
  }
  if (trimmed.length > 120 && /[.!?]$/.test(trimmed)) return trimmed;
  if (trimmed.split(/\s+/).length <= 3) {
    const recentUserMsgs = ctx.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
      .slice(-3)
      .map((m) => m.content as string);
    if (recentUserMsgs.length > 0 && trimmed.split(/\s+/).length <= 8) {
      return `${recentUserMsgs[recentUserMsgs.length - 1]} ${trimmed}`.trim().slice(0, 300);
    }
    if (recentUserMsgs.length === 0) return trimmed;
  }
  try {
    const recentContext = ctx.messages
      .slice(-6)
      .filter((m) => typeof m.content === 'string')
      .map((m) => `${m.role}: ${m.content}`.slice(0, 200))
      .join('\n');
    const prompt = `Rewrite the user's latest message into a standalone search query for a knowledge retrieval system.

Conversation context (most recent first):
${recentContext}

Latest user message: "${rawQuery}"

Rules:
- Output ONLY the reformulated search query, nothing else.
- Incorporate context from the conversation so the query is self-contained.
- If the message is already a clear standalone question, return it as-is.
- Keep it concise (1-2 sentences max).
- Do not add quotes or prefixes.`;
    let reformulated = '';
    const request: CompletionRequest = {
      model: ctx.config.provider.activeModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxTokens: 150,
      stream: false,
    };
    for await (const chunk of ctx.provider.complete(request)) {
      if (chunk.type === 'text_delta' && chunk.content) reformulated += chunk.content;
    }
    const cleaned = reformulated.trim().replace(/^["']|["']$/g, '');
    return cleaned || rawQuery;
  } catch {
    return rawQuery;
  }
}
