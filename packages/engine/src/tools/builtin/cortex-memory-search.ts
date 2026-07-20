import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { resolveMemoryFabricSearchSessionFilter } from '@agentx/shared';
import { getMemoryFabricInstance } from '../../neural/MemoryFabric.js';
import { getEmbedderInstance } from '../../neural/OnnxEmbeddingProvider.js';
import { CHAT_MEMORY_TAG } from '../../neural/ChatTurnMemoryIngester.js';
import { USER_PROFILE_TAG } from '../../neural/UserChatMemoryIngester.js';
import { knowledgeBaseSearch } from './knowledge-base-search.js';

type CortexScope = 'session' | 'profile' | 'both';

function parseScope(raw: unknown): CortexScope {
  if (raw === 'session' || raw === 'profile' || raw === 'both') return raw;
  return 'both';
}

/**
 * Vector search over Neural Cortex chat/profile memory (no graph walk).
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

  const topK = typeof args['limit'] === 'number' ? Math.min(Math.max(1, args['limit']), 20) : 8;
  const scope = parseScope(args['scope']);
  const sessionFilter = resolveMemoryFabricSearchSessionFilter(context.sessionId, context.contextKind);
  const isSuper = sessionFilter === null;

  try {
    const embedding = await embedder.embed(query);
    const parts: string[] = [];

    const fmtNode = (n: { category?: string; label?: string; content?: string; sourceId?: string }, i: number): string => {
      const cat = n.category ?? '?';
      const label = n.label ?? '';
      const content = (n.content ?? '').replace(/\n+/g, ' ').slice(0, 400);
      const src = n.sourceId ? ` [src:${n.sourceId.slice(0, 8)}]` : '';
      return `[${i + 1}] (${cat}) ${label}${src}\n${content}${content.length >= 400 ? '…' : ''}`;
    };

    let count = 0;

    if (scope === 'session' || scope === 'both') {
      const chatNodes = await fabric.vectorSearch(embedding, {
        limit: topK,
        tag: CHAT_MEMORY_TAG,
        sessionId: sessionFilter,
      });
      if (chatNodes.length > 0) {
        parts.push('=== SESSION MEMORY ===');
        chatNodes.forEach((n, i) => parts.push(fmtNode(n, i)));
        count += chatNodes.length;
      }

      if (!isSuper && scope === 'session') {
        const sessionNodes = await fabric.vectorSearch(embedding, {
          limit: topK,
          sessionId: sessionFilter,
        });
        const extra = sessionNodes.filter((n) => n.tag !== CHAT_MEMORY_TAG && n.tag !== USER_PROFILE_TAG);
        if (extra.length > 0) {
          parts.push('\n=== SESSION CONTEXT ===');
          extra.slice(0, topK).forEach((n, i) => parts.push(fmtNode(n, i)));
          count += extra.length;
        }
      }
    }

    if ((scope === 'profile' || scope === 'both') && isSuper) {
      const profileNodes = await fabric.vectorSearch(embedding, {
        limit: Math.max(3, Math.floor(topK / 2)),
        tag: USER_PROFILE_TAG,
        sessionId: null,
      });
      if (profileNodes.length > 0) {
        parts.push('\n=== USER PROFILE ===');
        profileNodes.forEach((n, i) => parts.push(fmtNode(n, i)));
        count += profileNodes.length;
      }
    }

    if (parts.length === 0) {
      return {
        success: true,
        output: 'No matching cortex memories. Chat turns are embedded after each conversation.',
        metadata: { count: 0 },
      };
    }

    return { success: true, output: parts.join('\n\n'), metadata: { count } };
  } catch (e) {
    return {
      success: false,
      output: `Cortex memory search failed: ${e instanceof Error ? e.message : String(e)}`,
      error: 'CORTEX_ERROR',
    };
  }
}
