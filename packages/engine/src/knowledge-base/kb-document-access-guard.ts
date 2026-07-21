import type { ToolResult } from '@agentx/shared';

/** Turn policy: user pinned Knowledge Base document(s) via @kb[…]. */
export interface KbDocumentTurnPolicy {
  active: true;
  sourceIds: string[];
  names: string[];
}

/** Disk / shell tools that must not open original KB uploads when @kb is pinned. */
export const KB_DISK_FALLBACK_TOOL_IDS = new Set([
  'shell_exec',
  'bash',
  'python_rpc',
  'script_run',
  'node_rpc',
  'file_read',
  'file_write',
  'file_edit',
  'file_append',
  'file_delete',
  'file_find',
  'file_metadata',
  'file_info',
  'glob',
  'folder_list',
  'folder_tree',
  'list_dir',
  'search_files',
  'grep',
  'ripgrep',
  'code_grep',
  'code_search',
  'codebase_search',
]);

/** Tools still allowed while a KB document is pinned. */
export const KB_PINNED_ALLOWED_TOOLS = new Set([
  'knowledge_base_search',
  'ask_clarification',
  'todo_write',
  'todo_read',
  'web_search',
  'deep_web_search',
  'web_fetch',
  'fetch',
  'fetch_url',
  'http_get',
  'http_request',
  'cortex_memory_search',
  'memory_recall',
]);

export function isKbDiskFallbackTool(toolId: string): boolean {
  if (KB_PINNED_ALLOWED_TOOLS.has(toolId)) return false;
  if (toolId.startsWith('integration__')) return false;
  return KB_DISK_FALLBACK_TOOL_IDS.has(toolId);
}

/**
 * Hard-block disk/shell reads when the user @kb-mentioned Knowledge Base docs.
 * The embedded Knowledge Base is the only allowed access path for those files.
 */
export function blockKbDiskFallback(
  toolId: string,
  policy: KbDocumentTurnPolicy | null,
): ToolResult | null {
  if (!policy?.active) return null;
  if (!isKbDiskFallbackTool(toolId)) return null;

  const docs = policy.names.length > 0
    ? policy.names.join(', ')
    : policy.sourceIds.join(', ');

  return {
    success: false,
    output: [
      '[Knowledge Base] Blocked: cannot open original Knowledge Base uploads from disk or shell.',
      `Pinned document(s): ${docs}.`,
      'Use knowledge_base_search with the sourceId from the @kb mention.',
      'If search returns no matches, say the document may still be indexing (READY) — do not fall back to file_read/shell_exec.',
    ].join(' '),
    error: 'KB_DISK_FALLBACK_DENIED',
  };
}
