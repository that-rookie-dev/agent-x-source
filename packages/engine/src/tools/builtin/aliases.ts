import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { resolveMemoryFabricSearchSessionFilter } from '@agentx/shared';
import * as fs from './filesystem.js';
import * as code from './code.js';
import * as web from './web.js';
import * as ai from './ai.js';
import * as shell from './shell.js';
import { getRAGEngineInstance } from '../../commands/builtin/rag_index.js';
import { getMemoryFabricInstance } from '../../neural/MemoryFabric.js';
import { getEmbedderInstance } from '../../neural/OnnxEmbeddingProvider.js';
import { knowledgeBaseSearch } from './knowledge-base-search.js';
import { cortexMemorySearch } from './cortex-memory-search.js';
import { USER_PROFILE_TAG } from '../../neural/UserChatMemoryIngester.js';
import { CHAT_MEMORY_TAG } from '../../neural/ChatTurnMemoryIngester.js';

async function tryImport<T>(path: string, exportName: string): Promise<T | null> {
  try {
    const mod = await import(path);
    return mod[exportName] as T;
  } catch {
    return null;
  }
}

/** Alias for file_read — Cursor/Claude convention. */
export async function readFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return fs.fileRead({
    path: args['path'] ?? args['target_file'] ?? args['file'],
    offset: args['offset'] ?? args['start_line'],
    limit: args['limit'] ?? args['end_line'],
  }, context);
}

/** Shorthand alias for read_file. */
export async function read(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return readFile(args, context);
}

/** Alias for file_write. */
export async function writeFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return fs.fileWrite({
    path: args['path'] ?? args['file'],
    content: args['content'] ?? args['contents'],
    mode: args['mode'],
  }, context);
}

/** Alias for folder_list. */
export async function listDir(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return fs.folderList({ path: args['path'] ?? args['target_directory'] ?? args['directory'] }, context);
}

/** Alias for file_delete. */
export async function deleteFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return fs.fileDelete({ path: args['path'] ?? args['file'] }, context);
}

/** Alias for folder_create. */
export async function createDir(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return fs.folderCreate({ path: args['path'] ?? args['directory'] }, context);
}

/** Alias for file_metadata. */
export async function fileInfo(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return fs.fileMetadata({ path: args['path'] ?? args['file'] }, context);
}

/** Alias for file_read — shell cat equivalent. */
export async function cat(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return readFile(args, context);
}

/** Alias for shell_exec — bash/run_command/execute. */
export async function runCommand(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return shell.shellExec({
    command: args['command'] ?? args['cmd'] ?? args['script'],
    cwd: args['cwd'] ?? args['working_directory'],
    timeout: args['timeout'],
    maxLength: args['maxLength'],
  }, context);
}

export const bash = runCommand;
export const execute = runCommand;

/** Alias for code_replace — file_edit with old_string/new_string. */
export async function fileEdit(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return code.codeReplace({
    path: args['path'] ?? args['file'] ?? args['target_file'],
    search: args['search'] ?? args['old_string'] ?? args['old'],
    replace: args['replace'] ?? args['new_string'] ?? args['new'],
  }, context);
}

/** Search files by name (glob) or content (code_search). */
export async function searchFiles(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = (args['pattern'] ?? args['query'] ?? args['glob']) as string;
  if (!pattern) return { success: false, output: 'pattern is required', error: 'INVALID_ARGS' };
  const looksLikeGlob = /[*?[\]]/.test(pattern) || pattern.startsWith('**');
  if (looksLikeGlob || args['glob']) {
    return glob({ pattern, path: args['path'] }, context);
  }
  return code.codeSearch({ pattern, path: args['path'], glob: args['glob'] as string | undefined }, context);
}

/** Parse Cursor-style patch text or delegate edits to file_patch. */
export async function applyPatch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  if (Array.isArray(args['edits'])) {
    return code.filePatch({ file: args['file'] ?? args['path'], edits: args['edits'] }, context);
  }

  const patchText = args['patch'] as string | undefined;
  if (!patchText) {
    return { success: false, output: 'patch text or edits array is required', error: 'INVALID_ARGS' };
  }

  const fileFromArgs = (args['path'] ?? args['file']) as string | undefined;
  const fileMatch = patchText.match(/\*\*\* Update File:\s*(.+)/);
  const file = fileFromArgs ?? fileMatch?.[1]?.trim();
  if (!file) {
    return { success: false, output: 'Could not determine target file from patch', error: 'INVALID_ARGS' };
  }

  const minus: string[] = [];
  const plus: string[] = [];
  for (const line of patchText.split('\n')) {
    if (line.startsWith('-') && !line.startsWith('---')) minus.push(line.slice(1));
    else if (line.startsWith('+') && !line.startsWith('+++')) plus.push(line.slice(1));
  }

  if (minus.length === 0 && plus.length === 0) {
    return { success: false, output: 'No +/- hunks found in patch', error: 'INVALID_ARGS' };
  }

  return code.filePatch({
    file,
    edits: [{ search: minus.join('\n'), replace: plus.join('\n') }],
  }, context);
}

/** Alias for file_find — find files by glob pattern. */
export async function glob(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = (args['pattern'] ?? args['glob']) as string;
  return fs.fileFind({ pattern, path: args['path'] }, context);
}

/** Alias for code_grep — search file contents by regex. */
export async function grep(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return code.codeGrep({
    pattern: args['pattern'] ?? args['query'],
    path: args['path'],
    context: args['context'],
    glob: args['glob'],
  }, context);
}

/** Alias for http_get — fetch URL content. */
export async function webFetch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return web.httpGet({ url: args['url'], headers: args['headers'] }, context);
}

/** Alias for memory_recall — read agent memory by key. */
export async function memoryRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return ai.memoryRecall({ key: args['key'] ?? args['query'] }, context);
}

/** Search agent memory keys (prefix/substring) and semantic chat memories in the fabric. */
export async function memorySearch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const query = (args['query'] ?? args['pattern']) as string;
  if (!query) return { success: false, output: 'query is required', error: 'INVALID_ARGS' };

  const fabric = getMemoryFabricInstance();
  const embedder = getEmbedderInstance();
  const sessionFilter = resolveMemoryFabricSearchSessionFilter(context.sessionId, context.contextKind);
  const isSuper = sessionFilter === null;
  if (fabric && embedder) {
    try {
      const embedding = await embedder.embed(query);
      const [chatNodes, profileNodes] = await Promise.all([
        fabric.vectorSearch(embedding, { limit: 8, tag: CHAT_MEMORY_TAG, sessionId: sessionFilter }),
        isSuper
          ? fabric.vectorSearch(embedding, { limit: 5, tag: USER_PROFILE_TAG, sessionId: null })
          : Promise.resolve([]),
      ]);
      const lines: string[] = [];
      if (chatNodes.length > 0) {
        lines.push('=== PAST CONVERSATIONS ===');
        chatNodes.forEach((n, i) => {
          const body = (n.content ?? '').replace(/\n+/g, ' ').slice(0, 350);
          lines.push(`[${i + 1}] ${n.label ?? 'chat'}\n${body}${body.length >= 350 ? '…' : ''}`);
        });
      }
      if (profileNodes.length > 0) {
        lines.push('\n=== USER PROFILE ===');
        profileNodes.forEach((n, i) => {
          lines.push(`[${i + 1}] ${n.label ?? 'profile'}: ${(n.content ?? '').slice(0, 200)}`);
        });
      }
      if (lines.length > 0) {
        return { success: true, output: lines.join('\n'), metadata: { count: chatNodes.length + profileNodes.length } };
      }
    } catch { /* fall through to legacy memory */ }
  }

  try {
    const listMemories = await tryImport<(q?: string) => Promise<Array<{ key: string; value: string }>>>(
      '../../memory/index.js',
      'listMemories',
    );
    if (!listMemories) {
      return { success: false, output: 'Memory search not available — use memory_recall with a known key', error: 'MODULE_NOT_FOUND' };
    }
    const all = await listMemories();
    const q = query.toLowerCase();
    const filtered = all.filter((m) => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q));
    if (filtered.length === 0) return { success: true, output: 'No matching memories' };
    const lines = filtered.slice(0, 20).map((m) => `${m.key}: ${m.value.slice(0, 120)}${m.value.length > 120 ? '…' : ''}`);
    return { success: true, output: lines.join('\n'), metadata: { count: filtered.length } };
  } catch {
    return { success: false, output: 'Memory module not available', error: 'MODULE_NOT_FOUND' };
  }
}

/** Semantic search over indexed codebase (requires /index or rag.enabled). */
export async function ragSearch(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const query = args['query'] as string;
  if (!query) return { success: false, output: 'query is required', error: 'INVALID_ARGS' };

  const engine = getRAGEngineInstance();
  if (!engine?.isEnabled) {
    return { success: false, output: 'RAG not enabled. Run /index or enable rag.enabled in config.', error: 'RAG_DISABLED' };
  }

  const topK = (args['limit'] as number) ?? 8;
  try {
    const docs = await engine.search(query, topK);
    if (docs.length === 0) return { success: true, output: 'No indexed matches. Run /index on the codebase first.' };
    const lines = docs.map((d, i) => {
      const path = (d.metadata?.path as string) ?? d.id ?? `doc-${i}`;
      const snippet = d.content.slice(0, 400).replace(/\n/g, ' ');
      return `[${i + 1}] ${path}\n${snippet}${d.content.length > 400 ? '…' : ''}`;
    });
    return { success: true, output: lines.join('\n\n'), metadata: { count: docs.length } };
  } catch (e) {
    return { success: false, output: `RAG search failed: ${e instanceof Error ? e.message : String(e)}`, error: 'RAG_ERROR' };
  }
}

/** @deprecated Use knowledgeBaseSearch */
export const knowledgeSearch = knowledgeBaseSearch;

/** @deprecated Use cortexMemorySearch */
export const memoryFabricSearch = cortexMemorySearch;

export { knowledgeBaseSearch, cortexMemorySearch };
