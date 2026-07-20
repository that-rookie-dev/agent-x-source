import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { deriveMarkdownTitle } from '@agentx/shared';
import { getMarkdownDocumentStoreInstance } from '../../markdown/MarkdownDocumentStore.js';

/** Persist a markdown document for reports, saved replies, and structured deliverables. */
export async function saveToMarkdown(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const store = getMarkdownDocumentStoreInstance();
  if (!store) {
    return { success: false, output: 'Markdown store not available', error: 'NOT_CONFIGURED' };
  }

  const contentMarkdown = String(args['content'] ?? args['markdown'] ?? args['content_markdown'] ?? '').trim();
  const legacyTsx = String(args['content_tsx'] ?? args['tsx'] ?? '').trim();

  if (!contentMarkdown && !legacyTsx) {
    return { success: false, output: 'content (markdown) is required', error: 'MISSING_PARAMS' };
  }

  const title = deriveMarkdownTitle({
    title: String(args['title'] ?? '').trim(),
    contentMarkdown: contentMarkdown || undefined,
    contentTsx: legacyTsx || undefined,
  });
  const messageId = typeof args['message_id'] === 'string' ? args['message_id'] : undefined;
  const sourceRole = args['source_role'] as 'user' | 'assistant' | 'system' | undefined;

  try {
    const record = await store.create({
      sessionId: context.sessionId,
      title,
      messageId,
      sourceRole,
      contentMarkdown: contentMarkdown || undefined,
      contentTsx: !contentMarkdown ? legacyTsx : undefined,
      contentFormat: 'markdown',
    });

    return {
      success: true,
      output: `Markdown saved: "${record.title}" (id: ${record.id}). Open Markdown in the sidebar to view or export as PDF.`,
      metadata: { markdownId: record.id, sessionId: record.sessionId, contentFormat: record.contentFormat },
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : 'Failed to save markdown document',
      error: 'SAVE_FAILED',
    };
  }
}

/** List saved markdown documents from the sidebar (not the filesystem). */
export async function markdownList(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const store = getMarkdownDocumentStoreInstance();
  if (!store) {
    return { success: false, output: 'Markdown store not available', error: 'NOT_CONFIGURED' };
  }

  const limit = typeof args['limit'] === 'number' ? args['limit'] : 50;
  const sessionOnly = args['session_only'] === true;

  try {
    const records = sessionOnly
      ? await store.listForSession(context.sessionId, limit)
      : await store.list(limit, 0);

    if (records.length === 0) {
      return { success: true, output: 'No saved markdown documents found.' };
    }

    const lines = records.map((r, i) => {
      const date = String(r.createdAt).slice(0, 10);
      return `${i + 1}. **${r.title}** (id: \`${r.id}\`) — ${date}`;
    });
    return {
      success: true,
      output: `Found ${records.length} saved markdown document(s):\n\n${lines.join('\n')}`,
      metadata: { count: records.length, ids: records.map((r) => r.id) },
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : 'Failed to list markdown documents',
      error: 'LIST_FAILED',
    };
  }
}
