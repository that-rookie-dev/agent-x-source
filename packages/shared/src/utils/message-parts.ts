import { stripToolNoise } from './text-sanitize.js';
import { appendStreamText, repairStreamTextGlitches } from './stream-text.js';

export interface PersistedToolCall {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  status?: 'running' | 'done' | 'error';
  elapsed?: number;
  metadata?: Record<string, unknown>;
}

export interface MessagePart {
  type: 'text' | 'tool' | 'subagent';
  id: string;
  content?: string;
  tool?: PersistedToolCall;
  agent?: {
    id: string;
    name: string;
    task: string;
    status: 'running' | 'done' | 'error';
    result?: string;
    toolCalls?: PersistedToolCall[];
  };
}

type DbPartRow = Record<string, unknown>;

function preferToolEntry(a: PersistedToolCall, b: PersistedToolCall): PersistedToolCall {
  const score = (s?: string) => (s === 'done' || s === 'error' ? 2 : s === 'running' ? 0 : 1);
  const winner = score(b.status) > score(a.status) ? b : score(a.status) > score(b.status) ? a : (b.result && !a.result ? b : a);
  const loser = winner === a ? b : a;
  return { ...loser, ...winner, status: winner.status ?? loser.status ?? 'done' };
}

/** Collapse duplicate tool parts (same call id) and optionally finalize stale running tools. */
export function dedupeToolParts(parts: MessagePart[], finalize = false): MessagePart[] {
  const result: MessagePart[] = [];
  const toolIndexById = new Map<string, number>();

  for (const p of parts) {
    if (p.type !== 'tool' || !p.tool) {
      result.push(p);
      continue;
    }
    let tool = p.tool;
    if (finalize && tool.status === 'running') {
      tool = { ...tool, status: 'done' };
    }
    const id = tool.id;
    const existingIdx = toolIndexById.get(id);
    if (existingIdx != null) {
      const existing = result[existingIdx]!;
      if (existing.type === 'tool' && existing.tool) {
        result[existingIdx] = { ...existing, tool: preferToolEntry(existing.tool, tool) };
      }
    } else {
      toolIndexById.set(id, result.length);
      result.push({ ...p, id, tool });
    }
  }
  return result;
}

function mergeTextParts(parts: MessagePart[]): MessagePart[] {
  const merged: MessagePart[] = [];
  for (const p of parts) {
    if (p.type === 'text' && p.content) {
      const prev = merged[merged.length - 1];
      if (prev?.type === 'text') {
        merged[merged.length - 1] = { ...prev, content: (prev.content || '') + p.content };
      } else {
        merged.push({ ...p, content: p.content });
      }
    } else {
      merged.push(p);
    }
  }
  return merged;
}

/** Build UI parts from message_parts table rows (chronological). */
export function buildPartsFromDbRows(
  rows: DbPartRow[],
  fallbackContent?: string,
  fallbackTools?: PersistedToolCall[],
): MessagePart[] {
  const built: MessagePart[] = [];

  for (const p of rows) {
    const partType = (p['type'] as string) || '';
    if (partType === 'text-delta' && p['content']) {
      const delta = p['content'] as string;
      const prev = built[built.length - 1];
      if (prev?.type === 'text') {
        prev.content = appendStreamText(prev.content || '', delta);
      } else {
        built.push({ type: 'text', id: crypto.randomUUID(), content: delta });
      }
    } else if (partType === 'tool-call') {
      const tid = (p['tool_call_id'] as string) || crypto.randomUUID();
      const existingIdx = built.findIndex((b) => b.type === 'tool' && b.tool?.id === tid);
      if (existingIdx >= 0) continue;
      built.push({
        type: 'tool',
        id: tid,
        tool: {
          id: tid,
          name: (p['tool_name'] as string) || 'unknown',
          args: parseJsonField(p['tool_args']),
          status: 'running',
        },
      });
    } else if (partType === 'tool-result') {
      const tid = (p['tool_call_id'] as string) || crypto.randomUUID();
      const idx = built.findIndex((b) => b.type === 'tool' && b.tool?.id === tid);
      const tool: PersistedToolCall = {
        id: tid,
        name: (p['tool_name'] as string) || (idx >= 0 ? built[idx]!.tool!.name : 'unknown'),
        args: idx >= 0 ? built[idx]!.tool?.args : parseJsonField(p['tool_args']),
        result: p['tool_result'] as string | undefined,
        status: (p['tool_success'] as number) === 0 ? 'error' : 'done',
      };
      if (idx >= 0) {
        built[idx] = { ...built[idx]!, tool: { ...built[idx]!.tool!, ...tool } };
      } else {
        built.push({ type: 'tool', id: tid, tool });
      }
    }
  }

  let parts = mergeTextParts(built.filter((p) => {
    if (p.type === 'text') return !!(p.content && p.content.trim());
    if (p.type === 'tool') return !!p.tool;
    return true;
  }));

  parts = parts.map((p) =>
    p.type === 'text' && p.content
      ? { ...p, content: repairStreamTextGlitches(stripToolNoise(p.content, { trim: false })) }
      : p,
  );

  if (parts.length === 0 && fallbackTools?.length) {
    parts = fallbackTools.map((t) => ({ type: 'tool' as const, id: t.id, tool: { ...t, status: t.status || 'done' as const } }));
    const clean = stripToolNoise(fallbackContent || '');
    if (clean) parts.unshift({ type: 'text', id: crypto.randomUUID(), content: clean });
  } else if (parts.length > 0 && fallbackContent) {
    const clean = stripToolNoise(fallbackContent);
    const hasText = parts.some((p) => p.type === 'text');
    if (clean && !hasText) {
      parts.unshift({ type: 'text', id: crypto.randomUUID(), content: clean });
    }
  }

  return dedupeToolParts(parts, true);
}

function parseJsonField(val: unknown): Record<string, unknown> | string | undefined {
  if (val == null) return undefined;
  if (typeof val === 'object') return val as Record<string, unknown>;
  if (typeof val === 'string') {
    try { return JSON.parse(val) as Record<string, unknown>; } catch { return val; }
  }
  return undefined;
}

/** Normalize stored parts JSON or reconstruct from toolCalls. */
export function normalizeMessageForUi(msg: Record<string, unknown>, sessionParts?: DbPartRow[]): {
  content: string;
  parts?: MessagePart[];
  toolCalls?: PersistedToolCall[];
} {
  const rawContent = (msg['content'] as string) || '';
  const content = repairStreamTextGlitches(stripToolNoise(rawContent));

  let toolCalls: PersistedToolCall[] | undefined;
  const rawTools = msg['tool_calls'] ?? msg['toolCalls'];
  if (rawTools) {
    try {
      const parsed = typeof rawTools === 'string' ? JSON.parse(rawTools) : rawTools;
      if (Array.isArray(parsed)) {
        toolCalls = parsed.map((t: Record<string, unknown>) => ({
          id: (t['id'] || t['callId'] || t['toolCallId'] || crypto.randomUUID()) as string,
          name: (t['name'] as string) || 'unknown',
          args: t['args'] as PersistedToolCall['args'],
          result: t['result'] as string | undefined,
          status: (t['status'] as PersistedToolCall['status']) || 'done',
          elapsed: t['elapsed'] as number | undefined,
          metadata: t['metadata'] as Record<string, unknown> | undefined,
        }));
      }
    } catch { /* ignore */ }
  }

  const storedParts = msg['parts'];
  if (Array.isArray(storedParts) && storedParts.length > 0) {
    const parts = dedupeToolParts((storedParts as MessagePart[]).map((p) => {
      if (p.type === 'text' && p.content) {
        return { ...p, content: repairStreamTextGlitches(stripToolNoise(p.content, { trim: false })) };
      }
      if (p.type === 'tool' && p.tool) return { ...p, tool: { ...p.tool, status: p.tool.status || 'done' } };
      return p;
    }), true);
    return { content, parts, toolCalls };
  }

  if (sessionParts && sessionParts.length > 0) {
    const msgCreatedAt = (msg['created_at'] as string) || '';
    const parts = buildPartsFromDbRows(sessionParts, content, toolCalls);
    if (parts.length > 0) return { content, parts, toolCalls };
    void msgCreatedAt;
  }

  if (toolCalls?.length) {
    const parts = dedupeToolParts([
      ...(content ? [{ type: 'text' as const, id: crypto.randomUUID(), content }] : []),
      ...toolCalls.map((t) => ({ type: 'tool' as const, id: t.id, tool: { ...t, status: t.status || 'done' as const } })),
    ], true);
    return { content, parts, toolCalls };
  }

  return { content, toolCalls };
}

/** Build parts array for SQLite persistence from turn accumulators. */
export function buildPartsForPersist(events: {
  textChunks: string[];
  tools: Map<string, PersistedToolCall>;
  order: Array<{ kind: 'text' | 'tool'; id?: string }>;
}): MessagePart[] {
  const parts: MessagePart[] = [];
  let textBuf = '';

  const flushText = () => {
    const clean = stripToolNoise(textBuf);
    if (clean) {
      parts.push({ type: 'text', id: crypto.randomUUID(), content: clean });
    }
    textBuf = '';
  };

  for (const item of events.order) {
    if (item.kind === 'text') {
      textBuf += events.textChunks.shift() || '';
    } else if (item.kind === 'tool' && item.id) {
      flushText();
      const tool = events.tools.get(item.id);
      if (tool) parts.push({ type: 'tool', id: item.id, tool });
    }
  }
  flushText();
  return parts;
}
