/**
 * Memory extraction and web search ingestion helpers extracted from Agent.ts (REFACTOR-2).
 */
import { getLogger, isMemoryFabricSuperSession, resolveMemoryFabricWriteSessionId, type SessionContextKind, type EmbeddingProvider } from '@agentx/shared';
import { MemoryExtractor } from '../secret-sauce/MemoryExtractor.js';
import { ChatTurnMemoryIngester } from '../neural/ChatTurnMemoryIngester.js';
import { UserChatMemoryIngester } from '../neural/UserChatMemoryIngester.js';
import type { MemoryFabric, MemoryNode } from '../neural/MemoryFabric.js';

const COMPACT_MEMORY_MAX_CHARS = 1500;
const FULL_MEMORY_MAX_CHARS = 4000;

export interface MemoryContextContext {
  graphRagRetriever: {
    retrieve(query: string, opts: Record<string, unknown>): Promise<{
      all: MemoryNode[];
      global: MemoryNode[];
      userProfile: MemoryNode[];
      episodic: MemoryNode[];
      vector: MemoryNode[];
      local: MemoryNode[];
      graph: MemoryNode[];
    }>;
  } | null;
  messages: Array<{ role: string; content: string | unknown }>;
  reformulateQuery(rawQuery: string): Promise<string>;
  sessionId: string;
  options: { contextKind?: SessionContextKind };
  config: { user?: { callsign?: string } };
  memoryFabric: MemoryFabric | null;
  memoryEmbedder: EmbeddingProvider | null;
  usesCompactContext(): boolean;
  setMemoryContextNodeIds(ids: string[]): void;
}

/**
 * Build the memory context block for the system prompt.
 */
export async function buildMemoryContext(ctx: MemoryContextContext): Promise<{ episodic: string; semantic: string; graph: string; community?: string }> {
  const retriever = ctx.graphRagRetriever;
  if (!retriever) return { episodic: '', semantic: '', graph: '' };
  try {
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user');
    const rawQuery = typeof lastUser?.content === 'string' ? lastUser.content : '';
    if (!rawQuery) return { episodic: '', semantic: '', graph: '' };

    const query = await ctx.reformulateQuery(rawQuery);

    const memorySessionId = ctx.sessionId;
    const isSuper = isMemoryFabricSuperSession(memorySessionId, ctx.options.contextKind);
    const result = await retriever.retrieve(query, {
      sessionId: memorySessionId,
      isSuperSession: isSuper,
      agentId: ctx.config.user?.callsign,
      globalLimit: isSuper ? 3 : 0,
      localLimit: isSuper ? 15 : 8,
      vectorLimit: 8,
      graphDepth: isSuper ? 2 : 1,
      minRelevance: 0.35,
    });

    const fabric = ctx.memoryFabric;
    const embedder = ctx.memoryEmbedder;
    let chunkNodes: MemoryNode[] = [];
    if (fabric && embedder) {
      try {
        const chunkEmbedding = await embedder.embed(query);
        chunkNodes = await fabric.vectorSearch(chunkEmbedding, {
          limit: 5,
          category: 'source_doc',
          ...(isSuper ? {} : { sessionId: memorySessionId }),
        });
        chunkNodes = chunkNodes.filter((n) => {
          const distance = n.distance;
          return distance == null || (1 - distance) >= 0.25;
        });
      } catch { /* best-effort */ }
    }

    const allNodeIds = new Set(result.all.map((n) => n.id));
    for (const cn of chunkNodes) {
      if (!allNodeIds.has(cn.id)) {
        result.vector.push(cn);
        result.all.push(cn);
        allNodeIds.add(cn.id);
      }
    }
    ctx.setMemoryContextNodeIds(result.all.map((n) => n.id).filter((id): id is string => !!id));

    const MAX_CHARS = ctx.usesCompactContext() ? COMPACT_MEMORY_MAX_CHARS : FULL_MEMORY_MAX_CHARS;
    const fmt = (nodes: Array<{ label: string; content: string; category: string }>, maxChars: number) => {
      const lines: string[] = [];
      let used = 0;
      for (const n of nodes) {
        const line = `- [${n.category}] ${n.label}: ${n.content.replace(/\n+/g, ' ').slice(0, 200)}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        used += line.length + 1;
      }
      return lines.join('\n');
    };
    const communityText = result.global.length > 0
      ? result.global.map((n) => `${n.label}: ${n.content.replace(/\n+/g, ' ').slice(0, 300)}`).join('\n')
      : undefined;
    const communityChars = communityText?.length ?? 0;
    const remainingAfterCommunity = Math.max(0, MAX_CHARS - communityChars);
    const userProfileText = fmt(result.userProfile, Math.floor(remainingAfterCommunity * 0.35));
    const episodicText = fmt(result.episodic, Math.floor(remainingAfterCommunity * 0.25));
    const semanticText = fmt(result.vector, Math.floor(remainingAfterCommunity * 0.25));
    const graphText = fmt([...result.local, ...result.graph], Math.floor(remainingAfterCommunity * 0.15));

    if (semanticText || communityText || episodicText || graphText || userProfileText) {
      getLogger().info('AGENT', `buildMemoryContext: ${result.all.length} nodes (community=${result.global.length}, userProfile=${result.userProfile.length}, episodic=${result.episodic.length}, semantic=${result.vector.length}, graph=${result.local.length + result.graph.length}, chunks=${chunkNodes.length})`);
    }

    return {
      community: communityText,
      episodic: [userProfileText, episodicText].filter(Boolean).join('\n'),
      semantic: semanticText,
      graph: graphText,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().warn('AGENT', `buildMemoryContext failed: ${msg}`);
    ctx.setMemoryContextNodeIds([]);
    return { episodic: '', semantic: '', graph: '' };
  }
}

export interface MemoryExtractionContext {
  config: { autoMemory?: boolean; neuralBrain?: boolean; provider: { activeModel: string } };
  provider: unknown;
  memoryExtractor: MemoryExtractor | null;
  setMemoryExtractor(e: MemoryExtractor): void;
  secretSauce: { recordMemory(content: string, category: string): void };
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
 * Extract memories from a user/assistant exchange and persist to multiple stores.
 */
export function extractMemories(
  ctx: MemoryExtractionContext,
  userMessage: string,
  assistantResponse: string,
): void {
  if (ctx.config['autoMemory'] === false) return;
  let extractor = ctx.memoryExtractor;
  if (!extractor) {
    extractor = new MemoryExtractor(ctx.provider as never, ctx.config.provider.activeModel);
    ctx.setMemoryExtractor(extractor);
  }

  void extractor.extract(userMessage, assistantResponse).then((memories) => {
    for (const mem of memories) {
      ctx.secretSauce.recordMemory(mem.content, mem.category);
    }
  }).catch(() => {
    // Silent failure — memory extraction is best-effort
  });

  const fabric = ctx.memoryFabric;
  const embedder = ctx.memoryEmbedder;
  if (fabric && embedder && ctx.config.neuralBrain !== false) {
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
    ).catch(() => {
      // Silent failure — chat turn embedding is best-effort
    });
  }

  // Super-session: persist user-profile facts to global vector memory
  if (!isMemoryFabricSuperSession(ctx.sessionId, ctx.options.contextKind)) return;
  if (!fabric || !embedder || ctx.config.neuralBrain === false) return;

  let userIngester = ctx.userChatMemoryIngester;
  if (!userIngester) {
    userIngester = new UserChatMemoryIngester(
      fabric,
      embedder,
      ctx.provider as never,
      ctx.config.provider.activeModel,
    );
    ctx.setUserChatMemoryIngester(userIngester);
  }

  void userIngester.ingestTurn(userMessage, assistantResponse, ctx.sessionId).catch(() => {
    // Silent failure — vector memory ingestion is best-effort
  });
}

export interface WebIngestContext {
  config: { neuralBrain?: boolean; provider: { activeModel: string } };
  provider: unknown;
  _pgPool: unknown;
  sessionId: string;
  options: { parentSessionId?: string; contextKind?: SessionContextKind };
}

/**
 * Ingest web search / fetch tool results into the neural brain.
 */
export async function ingestWebSearchResult(
  ctx: WebIngestContext,
  toolId: string,
  args: Record<string, unknown> | undefined,
  output: string,
): Promise<void> {
  try {
    if (ctx.config.neuralBrain === false) return;
    if (!ctx._pgPool) return;
    const query = typeof args?.['query'] === 'string' ? args['query'] : '';
    const url = typeof args?.['url'] === 'string' ? args['url'] : '';
    const label = query
      ? `Web Search: ${query.slice(0, 80)}`
      : url
        ? `Web Fetch: ${url.slice(0, 80)}`
        : `Web Result (${toolId})`;
    const content = query
      ? `Search query: ${query}\n\nResults:\n${output.slice(0, 4000)}`
      : `Source: ${url}\n\nContent:\n${output.slice(0, 4000)}`;

    const { MemoryService } = await import('../neural/MemoryService.js');
    const { OnnxEmbeddingProvider } = await import('../neural/OnnxEmbeddingProvider.js');
    const embedder = new OnnxEmbeddingProvider();
    const generate = async (prompt: string) => {
      let text = '';
      const request = {
        model: ctx.config.provider.activeModel,
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0,
        maxTokens: 2048,
        stream: false,
      };
      for await (const chunk of (ctx.provider as { complete(req: unknown): AsyncIterable<{ type: string; content?: string }> }).complete(request)) {
        if (chunk.type === 'text_delta' && chunk.content) text += chunk.content;
      }
      return text;
    };
    const service = new MemoryService(ctx._pgPool as never, embedder, generate);
    const storageSessionId = resolveMemoryFabricWriteSessionId(
      ctx.options.parentSessionId ?? ctx.sessionId,
      ctx.options.contextKind,
    );
    await service.ingest({
      text: content,
      label,
      category: 'source_doc',
      extract: true,
      embed: true,
      sessionId: storageSessionId,
    });
    getLogger().info('WEB_INGEST', `Ingested ${toolId} result (${output.length} chars) into neural brain`);
  } catch (e) {
    getLogger().warn('WEB_INGEST', `Failed to ingest web result: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface ReformulateQueryContext {
  usesCompactContext(): boolean;
  messages: Array<{ role: string; content: string | unknown }>;
  config: { provider: { activeModel: string } };
  provider: { complete(request: unknown): AsyncIterable<{ type: string; content?: string }> };
}

/**
 * Reformulate a user message into a standalone search query using conversation context.
 * Short follow-ups like "yes", "continue", "what about X?" get expanded into full
 * queries so RAG retrieval finds relevant memory instead of matching on noise.
 * Falls back to the raw message if reformulation fails.
 */
export async function reformulateQuery(ctx: ReformulateQueryContext, rawQuery: string): Promise<string> {
  const trimmed = rawQuery.trim();

  // Compact local models: avoid an extra LLM call; stitch short follow-ups from recent user text.
  if (ctx.usesCompactContext()) {
    if (trimmed.length > 80) return trimmed;
    const recentUserMsgs = ctx.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && (m.content as string).trim().length > 20)
      .slice(-3)
      .map((m) => (m as { content: string }).content);
    if (recentUserMsgs.length > 0 && trimmed.split(/\s+/).length <= 8) {
      return `${recentUserMsgs[recentUserMsgs.length - 1]} ${trimmed}`.trim().slice(0, 300);
    }
    return trimmed;
  }

  // Fast path: if the message is long and self-contained, skip reformulation.
  if (trimmed.length > 120 && /[.!?]$/.test(trimmed)) return trimmed;
  // Fast path: single-word or very short messages always need context.
  if (trimmed.split(/\s+/).length <= 3) {
    const recentUserMsgs = ctx.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && (m.content as string).trim().length > 20)
      .slice(-3)
      .map((m) => m.content as string);
    if (recentUserMsgs.length === 0) return trimmed;
  }

  try {
    const recentContext = ctx.messages
      .slice(-6)
      .filter((m) => typeof m.content === 'string')
      .map((m) => `${m.role}: ${m.content as string}`.slice(0, 200))
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
    const request = {
      model: ctx.config.provider.activeModel,
      messages: [{ role: 'user' as const, content: prompt }],
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
