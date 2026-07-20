import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { getKnowledgeBaseService } from '../../knowledge-base/global-manager.js';

/**
 * Semantic search over Knowledge Base uploads (PDFs, docs, etc.).
 */
export async function knowledgeBaseSearch(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const query = (args['query'] as string) ?? '';
  if (!query.trim()) return { success: false, output: 'query is required', error: 'INVALID_ARGS' };

  const kb = getKnowledgeBaseService();
  if (!kb) {
    return {
      success: false,
      output: 'Knowledge base unavailable. Upload documents via Knowledge Base first.',
      error: 'KB_UNAVAILABLE',
    };
  }

  const topK = typeof args['limit'] === 'number' ? Math.min(Math.max(1, args['limit']), 20) : 8;
  const sourceId = typeof args['sourceId'] === 'string' ? args['sourceId'] : undefined;
  try {
    const results = await kb.search(query, topK, sourceId);
    if (results.length === 0) {
      return { success: true, output: 'No knowledge-base matches. Confirm the document finished indexing (READY).' };
    }
    const lines = results.map((r, i) => {
      const page = r.metadata?.pageNumber != null ? ` p.${r.metadata.pageNumber}` : '';
      const title = r.sourceName || r.sourceId || 'source';
      const snippet = r.content.slice(0, 900).replace(/\n+/g, '\n');
      return `[${i + 1}] ${r.kind.toUpperCase()} · ${title}${page} · ${(r.score * 100).toFixed(1)}%\n${snippet}${r.content.length > 900 ? '…' : ''}`;
    });
    return {
      success: true,
      output: `Knowledge base matches (${results.length}):\n\n${lines.join('\n\n')}`,
      metadata: { count: results.length },
    };
  } catch (e) {
    return {
      success: false,
      output: `Knowledge base search failed: ${e instanceof Error ? e.message : String(e)}`,
      error: 'KB_ERROR',
    };
  }
}
