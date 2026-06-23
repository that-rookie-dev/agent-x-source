import type { PartEntry, ToolCall, UIMessage } from './types';

const EDIT_TOOLS = new Set(['file_write', 'write_file', 'file_patch', 'apply_patch', 'file_edit', 'code_replace', 'code_insert']);
const READ_TOOLS = new Set(['file_read', 'read', 'read_file', 'cat']);
const GLOB_TOOLS = new Set(['glob', 'file_find', 'search_files', 'code_search']);
const GREP_TOOLS = new Set(['grep', 'code_grep', 'search_in_files', 'code_references']);
const LIST_TOOLS = new Set(['folder_list', 'list_dir', 'ls', 'list_files']);
const SHELL_TOOLS = new Set(['shell_exec', 'shell_exec_streaming', 'shell_background', 'bash', 'execute', 'run_command']);

function argsPath(tool: ToolCall): string {
  if (typeof tool.args !== 'object' || !tool.args) return '';
  const a = tool.args as Record<string, unknown>;
  return String(a.path || a.filePath || a.file || '');
}

function pathMatches(tool: ToolCall, filePath?: string): boolean {
  if (!filePath) return true;
  const p = argsPath(tool);
  if (!p) return tool.status === 'running';
  return p === filePath || p.endsWith(filePath.split('/').pop() || '___');
}

function formatMatches(matches: unknown): string {
  if (!Array.isArray(matches)) return '';
  return matches.slice(0, 50).map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n');
}

export function patchToolFromOperation(tool: ToolCall, evType: string, ev: Record<string, unknown>): ToolCall | null {
  const meta = { ...(tool.metadata || {}) };

  switch (evType) {
    case 'operation_file_edited': {
      if (!EDIT_TOOLS.has(tool.name) || !pathMatches(tool, ev.filePath as string | undefined)) return null;
      const diff = (ev.diff as string) || '';
      return {
        ...tool,
        result: diff || tool.result,
        metadata: { ...meta, diff, filePath: ev.filePath, oldContent: ev.oldContent, newContent: ev.newContent },
      };
    }
    case 'operation_file_created': {
      if (!EDIT_TOOLS.has(tool.name) || !pathMatches(tool, ev.filePath as string | undefined)) return null;
      const content = (ev.content as string) || '';
      return {
        ...tool,
        metadata: { ...meta, content, filePath: ev.filePath, language: ev.language },
        result: tool.result || content.slice(0, 2000),
      };
    }
    case 'operation_file_read': {
      if (!READ_TOOLS.has(tool.name) || !pathMatches(tool, ev.filePath as string | undefined)) return null;
      const content = (ev.content as string) || '';
      return {
        ...tool,
        metadata: { ...meta, content, filePath: ev.filePath, language: ev.language },
        result: tool.result || content.slice(0, 4000),
      };
    }
    case 'operation_search_glob': {
      if (!GLOB_TOOLS.has(tool.name)) return null;
      const matches = formatMatches(ev.matches);
      return {
        ...tool,
        metadata: { ...meta, pattern: ev.pattern, directory: ev.directory, matchCount: ev.matchCount, matches: ev.matches },
        result: tool.result || matches,
      };
    }
    case 'operation_search_grep': {
      if (!GREP_TOOLS.has(tool.name)) return null;
      const matches = formatMatches(ev.matches);
      return {
        ...tool,
        metadata: { ...meta, pattern: ev.pattern, directory: ev.directory, matchCount: ev.matchCount, matches: ev.matches },
        result: tool.result || matches,
      };
    }
    case 'operation_list_files': {
      if (!LIST_TOOLS.has(tool.name)) return null;
      const files = formatMatches(ev.files);
      return {
        ...tool,
        metadata: { ...meta, directory: ev.directory, fileCount: ev.fileCount, files: ev.files },
        result: tool.result || files,
      };
    }
    case 'operation_command_executed': {
      if (!SHELL_TOOLS.has(tool.name)) return null;
      const stdout = (ev.stdout as string) || '';
      const stderr = (ev.stderr as string) || '';
      return {
        ...tool,
        metadata: { ...meta, command: ev.command, stdout, stderr, success: ev.success },
        result: tool.result || stdout || stderr,
      };
    }
    default:
      return null;
  }
}

export function applyOperationEventToAssistant(prev: UIMessage[], ev: Record<string, unknown> & { type: string }): UIMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role !== 'assistant') return prev;

  const toolCalls = last.toolCalls || [];
  const parts = last.parts || [];
  let changed = false;

  const newToolCalls = toolCalls.map((t) => {
    const updated = patchToolFromOperation(t, ev.type, ev);
    if (updated) { changed = true; return updated; }
    return t;
  });

  const newParts = parts.map((p): PartEntry => {
    if (p.type !== 'tool' || !p.tool) return p;
    const updated = patchToolFromOperation(p.tool, ev.type, ev);
    if (updated) { changed = true; return { ...p, tool: updated }; }
    return p;
  });

  if (!changed) return prev;
  return [...prev.slice(0, -1), { ...last, toolCalls: newToolCalls, parts: newParts }];
}
