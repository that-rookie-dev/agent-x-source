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

/**
 * Semantic search over ingested documents in the Memory Fabric (RAG Studio).
 * Uses vector ANN + graph walk to find relevant chunks and entities from
 * uploaded PDFs, text files, and web distillations.
 */
export async function memoryFabricSearch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const query = (args['query'] as string) ?? '';
  if (!query) return { success: false, output: 'query is required', error: 'INVALID_ARGS' };

  const fabric = getMemoryFabricInstance();
  const embedder = getEmbedderInstance();
  if (!fabric || !embedder) {
    return { success: false, output: 'Memory fabric not available. Upload documents via RAG Studio first.', error: 'FABRIC_UNAVAILABLE' };
  }

  const topK = (args['limit'] as number) ?? 8;
  const includeChunks = (args['includeChunks'] as boolean) ?? true;
  const sessionFilter = resolveMemoryFabricSearchSessionFilter(context.sessionId, context.contextKind);
  const isSuper = sessionFilter === null;
  try {
    const embedding = await embedder.embed(query);

    const [chatMemories, profileMemories] = await Promise.all([
      fabric.vectorSearch(embedding, { limit: topK, tag: CHAT_MEMORY_TAG, sessionId: sessionFilter }),
      isSuper
        ? fabric.vectorSearch(embedding, { limit: Math.max(3, Math.floor(topK / 2)), tag: USER_PROFILE_TAG, sessionId: null })
        : Promise.resolve([]),
    ]);

    // Pass 1: Vector search for direct semantic matches (scoped to session when not super).
    const vectorResults = await fabric.vectorSearch(embedding, {
      limit: topK * 2,
      ...(isSuper ? {} : { sessionId: sessionFilter }),
    });

    // Pass 2: Community summaries for high-level context (super sessions only).
    const communityResults = isSuper
      ? await fabric.searchCommunitySummaries(embedding, 3).catch(() => [])
      : [];

    // Filter: prefer semantic/entity nodes, include chunks only if requested.
    const seen = new Set<string>();
    const entities = vectorResults.filter((n) => {
      if (n.category === 'source_doc' && !includeChunks) return false;
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    // Graph walk from top entity seeds for related context.
    const seedIds = entities.slice(0, 3).map((n) => n.id).filter((id): id is string => !!id);
    let graphNodes: typeof vectorResults = [];
    if (seedIds.length > 0) {
      try {
        const walk = await fabric.graphWalk({ startNodeIds: seedIds, maxDepth: 1 });
        const newIds = walk.nodeIds.filter((id) => !seen.has(id)).slice(0, topK);
        if (newIds.length > 0) {
          const sessionClause = isSuper
            ? ''
            : ` AND session_id = $2`;
          const params: unknown[] = isSuper ? [newIds] : [newIds, sessionFilter];
          const { rows } = await (fabric as any)['pool'].query(
            `SELECT id, label, category, content, source_id AS "sourceId"
             FROM memory_nodes WHERE id = ANY($1::uuid[]) AND status = 'active'${sessionClause}`,
            params,
          );
          graphNodes = rows;
          for (const r of rows) seen.add(r.id);
        }
      } catch { /* best-effort */ }
    }

    // Format results.
    const fmtNode = (n: { category?: string; label?: string; content?: string; sourceId?: string }, i: number): string => {
      const cat = n.category ?? '?';
      const label = n.label ?? '';
      const content = (n.content ?? '').replace(/\n+/g, ' ').slice(0, 400);
      const src = n.sourceId ? ` [src:${n.sourceId.slice(0, 8)}]` : '';
      return `[${i + 1}] (${cat}) ${label}${src}\n${content}${content.length >= 400 ? '…' : ''}`;
    };

    const parts: string[] = [];
    if (chatMemories.length > 0) {
      parts.push('=== PAST CONVERSATIONS ===');
      chatMemories.forEach((n, i) => parts.push(fmtNode(n, i)));
    }
    if (profileMemories.length > 0) {
      parts.push('\n=== USER PROFILE MEMORIES ===');
      profileMemories.forEach((n, i) => parts.push(fmtNode(n, i)));
    }
    if (communityResults.length > 0) {
      parts.push('=== COMMUNITY SUMMARIES ===');
      communityResults.forEach((n, i) => parts.push(fmtNode(n, i)));
    }
    if (entities.length > 0) {
      parts.push('\n=== SEMANTIC MATCHES ===');
      entities.slice(0, topK).forEach((n, i) => parts.push(fmtNode(n, i)));
    }
    if (graphNodes.length > 0) {
      parts.push('\n=== RELATED (GRAPH WALK) ===');
      graphNodes.forEach((n, i) => parts.push(fmtNode(n, i)));
    }

    if (parts.length === 0) {
      return { success: true, output: 'No matching memories or documents found. Chat turns are embedded automatically after each conversation; upload files via RAG Studio for document search.', metadata: { count: 0 } };
    }

    return { success: true, output: parts.join('\n\n'), metadata: { count: entities.length + graphNodes.length + chatMemories.length + profileMemories.length } };
  } catch (e) {
    return { success: false, output: `Memory fabric search failed: ${e instanceof Error ? e.message : String(e)}`, error: 'FABRIC_ERROR' };
  }
}
