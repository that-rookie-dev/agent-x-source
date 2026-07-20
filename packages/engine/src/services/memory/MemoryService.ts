import type { Pool } from 'pg';
import type {
  CompletionMessage,
  EmbeddingProvider,
} from '@agentx/shared';
import type { ICache } from '../../cache/ICache.js';
import type { ProviderInterface } from '../../providers/ProviderInterface.js';
import { getLogger, isMemoryFabricSuperSession, resolveMemoryFabricWriteSessionId } from '@agentx/shared';
import {
  MemoryFabric,
  getMemoryFabricInstance,
  setMemoryFabricInstance,
  type MemoryNode,
  type MemoryNodeCategory,
  type ContextAssemblyResult,
} from '../../neural/MemoryFabric.js';
import { OnnxEmbeddingProvider, getEmbedderInstance, setEmbedderInstance } from '../../neural/OnnxEmbeddingProvider.js';
import { vectorMemoryPrefetch } from '../../neural/VectorMemoryPrefetch.js';
import type { GenerateFn } from '../../neural/MemoryExtractor.js';
import { MemoryService as NeuralMemoryService, type IngestInput, type IngestResult } from '../../neural/MemoryService.js';
import { ChatTurnMemoryIngester } from '../../neural/ChatTurnMemoryIngester.js';
import { UserChatMemoryIngester } from '../../neural/UserChatMemoryIngester.js';
import { SecureVault } from '../../neural/SecureVault.js';
import { FULL_MEMORY_MAX_CHARS, COMPACT_MEMORY_MAX_CHARS } from '../../agent/context-profile.js';
import type { IJobQueue } from '../../queue/IJobQueue.js';
import { registerMemoryWorkers } from '../../queue/workers/memory-worker.js';
import type {
  IMemoryService,
  MemoryContextState,
  AssembleContextOptions,
  ChatTurnIngestOptions,
  SearchOptions,
} from './IMemoryService.js';
import { MemoryCacheService, type MemoryCacheServiceOptions } from './MemoryCacheService.js';

export interface MemoryServiceOptions {
  pool: Pool;
  embeddingProvider?: EmbeddingProvider;
  provider?: ProviderInterface;
  model?: string;
  generate?: GenerateFn;
  cacheOptions?: MemoryCacheServiceOptions;
  cache?: ICache;
}

/**
 * Service facade for memory/RAG/embedding operations.
 *
 * Owns MemoryFabric, the embedding provider, and the document/chat ingesters.
 */
export class MemoryService implements IMemoryService {
  readonly name = 'MemoryService';

  private pool: Pool;
  private fabric: MemoryFabric;
  private embedder: EmbeddingProvider;
  private neuralService: NeuralMemoryService;
  private chatTurnIngester: ChatTurnMemoryIngester;
  private userChatIngester: UserChatMemoryIngester | null = null;
  private cacheService: MemoryCacheService;
  private provider?: ProviderInterface;
  private model?: string;
  private generateFn?: GenerateFn;
  private lastContextNodeIds: string[] = [];

  constructor(options: MemoryServiceOptions) {
    this.pool = options.pool;

    this.embedder =
      options.embeddingProvider ??
      getEmbedderInstance() ??
      new OnnxEmbeddingProvider();
    if (!getEmbedderInstance()) {
      setEmbedderInstance(this.embedder as OnnxEmbeddingProvider);
    }

    this.fabric = getMemoryFabricInstance() ?? new MemoryFabric(this.pool);
    if (!getMemoryFabricInstance()) {
      setMemoryFabricInstance(this.fabric);
    }

    this.provider = options.provider;
    this.model = options.model;
    this.generateFn = options.generate ?? this.buildGenerateFn();

    this.cacheService = new MemoryCacheService({ ...options.cacheOptions, cache: options.cache });
    this.neuralService = new NeuralMemoryService(this.pool, this.embedder, this.generateFn ?? null);
    this.chatTurnIngester = new ChatTurnMemoryIngester(this.fabric, this.embedder);
  }

  getFabric(): MemoryFabric {
    return this.fabric;
  }

  getCacheService(): MemoryCacheService {
    return this.cacheService;
  }

  /** Explicitly invalidate memory cache entries, optionally scoped by namespace or pattern. */
  invalidateCache(filter?: { namespace?: string; pattern?: RegExp }): void {
    this.cacheService.invalidate(filter);
  }

  registerJobWorkers(queue: IJobQueue): void {
    registerMemoryWorkers(queue, this);
  }

  getLastContextNodeIds(): string[] {
    return [...this.lastContextNodeIds];
  }

  setVault(key: Buffer): void {
    this.fabric.setVault(new SecureVault(this.pool, () => key));
  }

  async migrate(): Promise<void> {
    await this.fabric.migrate();
  }

  async assembleContext(
    sessionId: string,
    query: string,
    options?: AssembleContextOptions,
  ): Promise<MemoryContextState> {
    try {
      const {
        messages,
        contextKind,
        compact = false,
        vectorLimit,
        minRelevance,
      } = options ?? {};

      let effectiveQuery = query;
      if (!effectiveQuery.trim() && messages) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
        effectiveQuery = typeof lastUser?.content === 'string' ? lastUser.content : '';
      }
      if (!effectiveQuery.trim()) {
        return { episodic: '', semantic: '', graph: '' };
      }

      const isSuper = isMemoryFabricSuperSession(sessionId, contextKind);
      const reformulated = await this.reformulateQuery(effectiveQuery, messages, compact);

      const embedding = await this.cacheService.getOrComputeEmbedding(
        reformulated,
        () => this.embedder.embed(reformulated),
      );

      const prefetch = await vectorMemoryPrefetch(this.fabric, this.embedder, reformulated, {
        sessionId,
        isSuperSession: isSuper,
        vectorLimit: vectorLimit ?? 8,
        userProfileLimit: isSuper ? 8 : 0,
        episodicLimit: 5,
        minRelevance: minRelevance ?? 0.35,
      });

      const chunkNodes = await this.searchSourceDocChunks(embedding, sessionId, isSuper, minRelevance);
      const allNodeIds = new Set(prefetch.all.map((n) => n.id));
      for (const cn of chunkNodes) {
        if (!allNodeIds.has(cn.id)) {
          prefetch.vector.push(cn);
          prefetch.all.push(cn);
          allNodeIds.add(cn.id);
        }
      }

      this.lastContextNodeIds = prefetch.all.map((n) => n.id).filter((id): id is string => !!id);

      return this.formatVectorPrefetch(prefetch, compact);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      getLogger().warn('MEMORY_SERVICE', `assembleContext failed: ${msg}`);
      this.lastContextNodeIds = [];
      return { episodic: '', semantic: '', graph: '' };
    }
  }

  /**
   * Assemble raw context nodes (as opposed to formatted strings) for API consumers.
   */
  async assembleContextResult(
    sessionId: string,
    query: string,
    options: {
      embedding?: number[];
      agentId?: string;
      episodicLimit?: number;
      semanticLimit?: number;
      graphDepth?: number;
      useWeights?: boolean;
      limit?: number;
    } = {},
  ): Promise<ContextAssemblyResult> {
    const { embedding, agentId, episodicLimit = 5, semanticLimit = 10, graphDepth = 3, useWeights, limit = 10 } = options;
    const effectiveEmbedding =
      embedding ?? (await this.cacheService.getOrComputeEmbedding(query, () => this.embedder.embed(query)));

    let weighted: ContextAssemblyResult['semantic'] | undefined;
    if (useWeights) {
      const scored = await this.fabric.searchWeighted(effectiveEmbedding, { limit, agentId });
      weighted = scored.map((n) => {
        const { score, edgeWeight, ...rest } = n as MemoryNode & { score: number; edgeWeight: number };
        return rest;
      });
    }

    const result = await this.fabric.assembleContext(sessionId, effectiveEmbedding, {
      agentId,
      episodicLimit,
      semanticLimit,
      graphDepth,
    });

    if (weighted) {
      result.semantic = weighted;
    }
    return result;
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    return this.neuralService.ingest(input);
  }

  async ingestChatTurn(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    options?: ChatTurnIngestOptions,
  ): Promise<void> {
    try {
      const { storageSessionId, contextKind } = options ?? {};
      const resolvedStorageSessionId =
        storageSessionId ?? resolveMemoryFabricWriteSessionId(sessionId, contextKind);
      const isSuper = isMemoryFabricSuperSession(sessionId, contextKind);

      const promises: Promise<unknown>[] = [
        this.chatTurnIngester.ingestTurn(userMessage, assistantResponse, sessionId, resolvedStorageSessionId),
      ];

      if (isSuper && this.provider && this.model) {
        if (!this.userChatIngester) {
          this.userChatIngester = new UserChatMemoryIngester(
            this.fabric,
            this.embedder,
            this.provider,
            this.model,
          );
        }
        promises.push(this.userChatIngester.ingestTurn(userMessage, assistantResponse, sessionId));
      }

      await Promise.all(promises);
    } catch (e) {
      // Best-effort; chat turn memory is non-critical.
      getLogger().warn('MEMORY_SERVICE', `ingestChatTurn failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async search(query: string, options?: SearchOptions): Promise<MemoryNode[]> {
    const {
      embedding,
      limit,
      category,
      agentId,
      tag,
      sessionId,
      minRelevance,
    } = options ?? {};

    const effectiveEmbedding =
      embedding ??
      (await this.cacheService.getOrComputeEmbedding(query, () => this.embedder.embed(query)));

    const key = this.buildVectorSearchKey(effectiveEmbedding, { category, agentId, tag, sessionId, limit, minRelevance });
    return this.cacheService.getOrComputeVectorSearch(key, async () => {
      const raw = await this.fabric.vectorSearch(effectiveEmbedding, {
        limit,
        category,
        agentId,
        tag,
        sessionId,
      });
      if (minRelevance === undefined || minRelevance <= 0) return raw;
      return raw.filter((n) => {
        const distance = (n as unknown as { distance?: number }).distance;
        return distance == null || (1 - distance) >= minRelevance;
      });
    }) as Promise<MemoryNode[]>;
  }

  async reinforce(nodeIds?: string[]): Promise<void> {
    const ids = nodeIds ?? this.lastContextNodeIds;
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => this.fabric.reinforce(id).catch(() => {})));
  }

  dispose(): void {
    this.cacheService.clear();
  }

  private buildVectorSearchKey(
    embedding: number[],
    opts: { category?: MemoryNodeCategory; agentId?: string; tag?: string; sessionId?: string | null; limit?: number; minRelevance?: number },
  ): string {
    return this.cacheService.computeKey('vector-search', {
      embedding: embedding.slice(0, 8),
      ...opts,
    });
  }

  private async searchSourceDocChunks(
    embedding: number[],
    sessionId: string,
    isSuper: boolean,
    minRelevance?: number,
  ): Promise<MemoryNode[]> {
    const key = this.cacheService.computeKey('source-chunks', {
      embedding: embedding.slice(0, 8),
      sessionId,
      isSuper,
    });
    return this.cacheService.getOrComputeVectorSearch(key, async () => {
      const raw = await this.fabric.vectorSearch(embedding, {
        limit: 5,
        category: 'source_doc',
      });
      const threshold = minRelevance ?? 0.25;
      return raw.filter((n) => {
        const distance = (n as unknown as { distance?: number }).distance;
        return distance == null || (1 - distance) >= threshold;
      });
    }) as Promise<MemoryNode[]>;
  }

  private formatVectorPrefetch(
    result: Awaited<ReturnType<typeof vectorMemoryPrefetch>>,
    compact: boolean,
  ): MemoryContextState {
    const MAX_CHARS = compact ? COMPACT_MEMORY_MAX_CHARS : FULL_MEMORY_MAX_CHARS;

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
      getLogger().info(
        'MEMORY_SERVICE',
        `assembleContext: ${result.all.length} nodes (userProfile=${result.userProfile.length}, episodic=${result.episodic.length}, semantic=${result.vector.length})`,
      );
    }

    return {
      episodic: [userProfileText, episodicText].filter(Boolean).join('\n'),
      semantic: semanticText,
      graph: '',
    };
  }

  private async reformulateQuery(
    rawQuery: string,
    messages?: CompletionMessage[],
    compact = false,
  ): Promise<string> {
    const trimmed = rawQuery.trim();

    if (compact) {
      if (trimmed.length > 80) return trimmed;
      const recentUserMsgs = (messages ?? [])
        .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
        .slice(-3)
        .map((m) => (m as { content: string }).content);
      if (recentUserMsgs.length > 0 && trimmed.split(/\s+/).length <= 8) {
        return `${recentUserMsgs[recentUserMsgs.length - 1]} ${trimmed}`.trim().slice(0, 300);
      }
      return trimmed;
    }

    if (trimmed.length > 120 && /[.!?]$/.test(trimmed)) return trimmed;

    const recentUserMsgs = (messages ?? [])
      .filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 20)
      .slice(-3)
      .map((m) => (m as { content: string }).content);

    if (trimmed.split(/\s+/).length <= 3 && recentUserMsgs.length === 0) {
      return trimmed;
    }

    if (!this.provider || !this.model) return trimmed;

    try {
      const recentContext = (messages ?? [])
        .slice(-6)
        .filter((m) => typeof m.content === 'string')
        .map((m) => `${m.role}: ${(m as { content: string }).content}`.slice(0, 200))
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

      const request: CompletionMessage[] = [
        { role: 'user', content: prompt },
      ];

      let reformulated = '';
      for await (const chunk of this.provider.complete({ model: this.model, messages: request, temperature: 0, maxTokens: 150, stream: false })) {
        if (chunk.type === 'text_delta' && chunk.content) {
          reformulated += chunk.content;
        }
      }
      return reformulated.trim().replace(/^["']|["']$/g, '') || rawQuery;
    } catch {
      return rawQuery;
    }
  }

  private buildGenerateFn(): GenerateFn | undefined {
    const provider = this.provider;
    const model = this.model;
    if (!provider || !model) return undefined;
    return async (prompt: string) => {
      const messages: CompletionMessage[] = [{ role: 'user', content: prompt }];
      let text = '';
      for await (const chunk of provider.complete({ model, messages, temperature: 0, maxTokens: 2048, stream: false })) {
        if (chunk.type === 'text_delta' && chunk.content) {
          text += chunk.content;
        }
      }
      return text;
    };
  }
}
