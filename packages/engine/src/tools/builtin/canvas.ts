import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { deriveCanvasTitle } from '@agentx/shared';
import { getCanvasStoreInstance } from '../../canvas/CanvasStore.js';

/**
 * Persist an interactive canvas (.canvas.tsx) or markdown snapshot.
 * Prefer content_tsx for dashboards and rich artifacts; use content/markdown only for quick saves.
 */
export async function saveToCanvas(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const store = getCanvasStoreInstance();
  if (!store) {
    return { success: false, output: 'Canvas store not available', error: 'NOT_CONFIGURED' };
  }

  const contentTsx = String(args['content_tsx'] ?? args['tsx'] ?? '').trim();
  const contentMarkdown = String(args['content'] ?? args['markdown'] ?? '').trim();
  const explicitFormat = args['format'] as string | undefined;

  if (!contentTsx && !contentMarkdown) {
    return { success: false, output: 'content_tsx (preferred) or content/markdown is required', error: 'MISSING_PARAMS' };
  }

  const title = deriveCanvasTitle({
    title: String(args['title'] ?? '').trim(),
    contentTsx: contentTsx || undefined,
    contentMarkdown: !contentTsx ? contentMarkdown : undefined,
  });
  const messageId = typeof args['message_id'] === 'string' ? args['message_id'] : undefined;
  const sourceRole = args['source_role'] as 'user' | 'assistant' | 'system' | undefined;

  try {
    const record = await store.create({
      sessionId: context.sessionId,
      title,
      messageId,
      sourceRole,
      contentFormat: contentTsx ? 'canvas_tsx' : (explicitFormat === 'markdown' ? 'markdown' : 'canvas_tsx'),
      contentTsx: contentTsx || undefined,
      contentMarkdown: !contentTsx ? contentMarkdown : undefined,
    });

    const compileNote = record.compileError
      ? ` Warning: compile issue — ${record.compileError}`
      : '';

    return {
      success: true,
      output: `Canvas saved: "${record.title}" (id: ${record.id}, format: ${record.contentFormat}). Open Canvases in the sidebar to view or export as PDF.${compileNote}`,
      metadata: { canvasId: record.id, sessionId: record.sessionId, contentFormat: record.contentFormat },
    };
  } catch (err) {
    return {
      success: false,
      output: err instanceof Error ? err.message : 'Failed to save canvas',
      error: 'SAVE_FAILED',
    };
  }
}
