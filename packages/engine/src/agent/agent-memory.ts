/**
 * Memory extraction and web search ingestion helpers extracted from Agent.ts (REFACTOR-2).
 */
import { getLogger, isMemoryFabricSuperSession, resolveMemoryFabricWriteSessionId, type SessionContextKind, type EmbeddingProvider } from '@agentx/shared';
import { ChatTurnMemoryIngester } from '../neural/ChatTurnMemoryIngester.js';
import { UserChatMemoryIngester } from '../neural/UserChatMemoryIngester.js';
import type { MemoryFabric, MemoryNode } from '../neural/MemoryFabric.js';
import { vectorMemoryPrefetch } from '../neural/VectorMemoryPrefetch.js';

const COMPACT_MEMORY_MAX_CHARS = 1500;
const FULL_MEMORY_MAX_CHARS = 4000;

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

/**
 * Build the memory context block for the system prompt (vector-only prefetch).
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

    const result = await vectorMemoryPrefetch(fabric, embedder, query, {
      sessionId: memorySessionId,
      isSuperSession: isSuper,
      vectorLimit: 8,
      userProfileLimit: isSuper ? 8 : 0,
      episodicLimit: 5,
      minRelevance: 0.35,
    });

    let chunkNodes: MemoryNode[] = [];
    try {
      const chunkEmbedding = await embedder.embed(query);
      chunkNodes = await fabric.vectorSearch(chunkEmbedding, {
        limit: 5,
        category: 'source_doc',
      });
      chunkNodes = chunkNodes.filter((n) => {
        const distance = n.distance;
        return distance == null || (1 - distance) >= 0.25;
      });
    } catch { /* best-effort */ }

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

    const userProfileText = fmt(result.userProfile, Math.floor(MAX_CHARS * 0.35));
    const episodicText = fmt(result.episodic, Math.floor(MAX_CHARS * 0.25));
    const semanticText = fmt(result.vector, Math.floor(MAX_CHARS * 0.4));

    if (semanticText || episodicText || userProfileText) {
      getLogger().info('AGENT', `buildMemoryContext: ${result.all.length} nodes (userProfile=${result.userProfile.length}, episodic=${result.episodic.length}, semantic=${result.vector.length}, chunks=${chunkNodes.length})`);
    }

    return {
      episodic: [userProfileText, episodicText].filter(Boolean).join('\n'),
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
  provider: unknown;
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
 * Extract memories from a user/assistant exchange and persist to Memory Fabric.
 */
export function extractMemories(
  ctx: MemoryExtractionContext,
  userMessage: string,
  assistantResponse: string,
): void {
  if (ctx.config['autoMemory'] === false) return;

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
    ).catch(() => {
      // Silent failure — chat turn embedding is best-effort
    });
  }

  if (!isMemoryFabricSuperSession(ctx.sessionId, ctx.options.contextKind)) return;
  if (!fabric || !embedder) return;

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

export interface ReformulateQueryContext {
  usesCompactContext(): boolean;
  messages: Array<{ role: string; content: string | unknown }>;
  config: { provider: { activeModel: string } };
  provider: { complete(request: unknown): AsyncIterable<{ type: string; content?: string }> };
}

/**
 * Reformulate a user message into a standalone search query using conversation context.
 */
export async function reformulateQuery(ctx: ReformulateQueryContext, rawQuery: string): Promise<string> {
  const trimmed = rawQuery.trim();

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

  if (trimmed.length > 120 && /[.!?]$/.test(trimmed)) return trimmed;
  if (trimmed.split(/\s+/).length <= 3) {
    const recentUserMsgs = ctx.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && (m.content as string).trim().length > 20)
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
