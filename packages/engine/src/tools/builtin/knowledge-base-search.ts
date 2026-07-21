import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { getKnowledgeBaseService } from '../../knowledge-base/global-manager.js';
import { getRetrievalSettings } from '../../neural/retrieval/settings.js';

/** Minimal hit shape for citeable KB tool formatting. */
export interface KbToolHit {
  id: string;
  content: string;
  sourceId: string;
  sourceName: string;
  score: number;
  metadata?: {
    pageNumber?: number;
    headingPath?: unknown;
  };
}

/**
 * Format KB hits into citeable tool output (shared for tool + tests).
 */
export function formatKnowledgeBaseToolOutput(
  results: KbToolHit[],
  maxSnippetChars?: number,
): { output: string; evidenceIds: string[] } {
  const maxLine = maxSnippetChars ?? getRetrievalSettings().maxEvidenceLineChars;
  const lines = results.map((r, i) => {
    const page = r.metadata?.pageNumber != null ? ` p.${r.metadata.pageNumber}` : '';
    const heading = Array.isArray(r.metadata?.headingPath)
      ? ` · ${(r.metadata.headingPath as string[]).map((h) => String(h).replace(/^#+\s*/, '')).join(' › ')}`
      : '';
    const title = r.sourceName || r.sourceId || 'source';
    const snippet = r.content.slice(0, maxLine).replace(/\n+/g, ' ');
    return `[E${i + 1} · KB · ${title}${page}${heading} · score=${r.score.toFixed(2)}] id=${r.id}\n${snippet}${r.content.length > maxLine ? '…' : ''}`;
  });
  return {
    output: `Knowledge base matches (${results.length}). Cite [E#] when using these facts; do not invent sources.\n\n${lines.join('\n\n')}`,
    evidenceIds: results.map((r) => r.id),
  };
}

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
      return {
        success: true,
        output: [
          'No knowledge-base matches. Confirm the document finished indexing (READY).',
          'Do not fall back to file_read, shell_exec, or any disk open of the original upload — stay on knowledge_base_search or tell the user the document is not searchable yet.',
        ].join(' '),
      };
    }
    const formatted = formatKnowledgeBaseToolOutput(results);
    return {
      success: true,
      output: formatted.output,
      metadata: { count: results.length, evidenceIds: formatted.evidenceIds },
    };
  } catch (e) {
    return {
      success: false,
      output: `Knowledge base search failed: ${e instanceof Error ? e.message : String(e)}`,
      error: 'KB_ERROR',
    };
  }
}
