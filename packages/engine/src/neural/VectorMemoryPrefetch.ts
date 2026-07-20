import type { EmbeddingProvider } from '@agentx/shared';
import type { MemoryFabric, MemoryNode } from './MemoryFabric.js';
import { CHAT_MEMORY_TAG } from './ChatTurnMemoryIngester.js';
import { USER_PROFILE_TAG } from './UserChatMemoryIngester.js';

export interface VectorMemoryPrefetchOptions {
  sessionId: string;
  isSuperSession: boolean;
  vectorLimit?: number;
  userProfileLimit?: number;
  episodicLimit?: number;
  minRelevance?: number;
}

export interface VectorMemoryPrefetchResult {
  vector: MemoryNode[];
  episodic: MemoryNode[];
  userProfile: MemoryNode[];
  all: MemoryNode[];
}

function filterByRelevance(nodes: MemoryNode[], minRelevance: number): MemoryNode[] {
  if (minRelevance <= 0) return nodes;
  return nodes.filter((n) => {
    const distance = n.distance;
    return distance == null || (1 - distance) >= minRelevance;
  });
}

export async function vectorMemoryPrefetch(
  fabric: MemoryFabric,
  embedder: EmbeddingProvider,
  query: string,
  options: VectorMemoryPrefetchOptions,
): Promise<VectorMemoryPrefetchResult> {
  const vectorLimit = options.vectorLimit ?? 8;
  const userProfileLimit = options.userProfileLimit ?? 8;
  const episodicLimit = options.episodicLimit ?? 5;
  const minRelevance = options.minRelevance ?? 0.35;
  const isSuper = options.isSuperSession;

  const embedding = await embedder.embed(query);

  const vectorRaw = await fabric.vectorSearch(embedding, {
    limit: vectorLimit,
    ...(isSuper ? {} : { sessionId: options.sessionId }),
  });
  const vector = filterByRelevance(vectorRaw, minRelevance);

  const userProfileRaw = isSuper
    ? await fabric.vectorSearch(embedding, {
        limit: userProfileLimit,
        tag: USER_PROFILE_TAG,
        sessionId: null,
      })
    : [];
  const userProfile = filterByRelevance(userProfileRaw, minRelevance);

  let episodic: MemoryNode[] = [];
  if (options.sessionId) {
    const assembled = await fabric.assembleContext(options.sessionId, embedding, {
      episodicLimit,
      semanticLimit: 0,
      graphDepth: 0,
    });
    episodic = assembled.episodic;
  }

  const chatScoped = isSuper
    ? []
    : filterByRelevance(
        await fabric.vectorSearch(embedding, {
          limit: vectorLimit,
          tag: CHAT_MEMORY_TAG,
          sessionId: options.sessionId,
        }),
        minRelevance,
      );

  const seen = new Set<string>();
  const all: MemoryNode[] = [];
  for (const node of [...userProfile, ...episodic, ...chatScoped, ...vector]) {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      all.push(node);
    }
  }

  return { vector, episodic, userProfile, all };
}
