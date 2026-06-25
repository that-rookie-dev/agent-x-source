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

import type { QuestionnaireRecord } from '../types/questionnaire.js';

export interface MessagePart {
  type: 'text' | 'tool' | 'subagent' | 'questionnaire';
  id: string;
  content?: string;
  questionnaire?: QuestionnaireRecord;
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

function textFromParts(parts: MessagePart[]): string {
  return parts
    .filter((p) => p.type === 'text' && p.content)
    .map((p) => p.content!)
    .join('');
}

/** True when parts[] tool ids/count disagree with canonical toolCalls on the message row. */
export function partsToolIdsMismatch(parts: MessagePart[], toolCalls?: PersistedToolCall[]): boolean {
  const partIds = parts
    .filter((p) => p.type === 'tool' && p.tool?.id)
    .map((p) => p.tool!.id);
  const callIds = (toolCalls ?? []).map((t) => t.id);
  if (partIds.length === 0 && callIds.length === 0) return false;
  if (partIds.length !== callIds.length) return true;
  const callSet = new Set(callIds);
  return partIds.some((id) => !callSet.has(id));
}

/** True when parts text is longer than content but still contains content's opening (merged turns). */
export function partsTextExceedsContent(content: string, parts: MessagePart[]): boolean {
  const partsText = stripToolNoise(textFromParts(parts), { trim: false });
  const cleanContent = stripToolNoise(content, { trim: false });
  if (!cleanContent || !partsText) return false;
  if (partsText.length <= cleanContent.length * 1.08) return false;
  const prefix = cleanContent.slice(0, Math.min(60, cleanContent.length));
  return prefix.length >= 20 && partsText.includes(prefix);
}

/** Decide whether stored parts[] should be discarded in favour of content + toolCalls. */
export function shouldRebuildStoredParts(
  content: string,
  parts: MessagePart[],
  toolCalls?: PersistedToolCall[],
): boolean {
  if (!parts.length) return false;
  if (partsCorruptedByCrossTurn(content, parts)) return true;
  if (partsToolIdsMismatch(parts, toolCalls)) return true;
  if (partsTextExceedsContent(content, parts)) return true;
  return false;
}

export function rebuildPartsFromCanonical(content: string, toolCalls?: PersistedToolCall[]): MessagePart[] {
  return dedupeToolParts([
    ...(content ? [{ type: 'text' as const, id: crypto.randomUUID(), content }] : []),
    ...(toolCalls ?? []).map((t) => ({
      type: 'tool' as const,
      id: t.id,
      tool: { ...t, status: t.status || 'done' as const },
    })),
  ], true);
}

/**
 * Detect when persisted parts[] accumulated prior-turn content (parts grow across turns
 * but content holds the canonical single-turn text from message_received).
 */
export function partsCorruptedByCrossTurn(content: string, parts: MessagePart[]): boolean {
  const partsText = textFromParts(parts);
  const cleanContent = stripToolNoise(content);
  const cleanParts = stripToolNoise(partsText, { trim: false });
  if (!cleanContent || !cleanParts) return false;

  const contentLead = cleanContent.slice(0, Math.min(80, cleanContent.length));
  const partsLead = cleanParts.slice(0, Math.min(80, cleanParts.length));
  if (contentLead.length < 20 || partsLead.length < 20) return false;
  if (contentLead === partsLead) return false;

  // Parts embed this turn's content after a prior-turn prefix
  if (cleanParts.length > cleanContent.length * 1.15 && cleanParts.includes(contentLead.slice(0, 40))) {
    return true;
  }
  // Parts and content are from unrelated turns (no shared opening)
  if (!cleanParts.includes(contentLead.slice(0, 40)) && !cleanContent.includes(partsLead.slice(0, 40))) {
    return true;
  }
  return false;
}

/** Assign message_parts rows to one assistant message (turn window: after prev user, through assistant). */
export function assignPartsToAssistantMessage(
  messages: Array<Record<string, unknown>>,
  allParts: DbPartRow[],
  assistantIndex: number,
): DbPartRow[] {
  const msg = messages[assistantIndex]!;
  const msgCreatedAt = (msg['created_at'] as string) || '';

  let prevUserCreatedAt = '';
  for (let j = assistantIndex - 1; j >= 0; j--) {
    if (messages[j]!['role'] === 'user') {
      prevUserCreatedAt = (messages[j]!['created_at'] as string) || '';
      break;
    }
  }

  return allParts.filter((p) => {
    const pca = (p['created_at'] as string) || '';
    if (prevUserCreatedAt && pca && pca <= prevUserCreatedAt) return false;
    if (msgCreatedAt && pca && pca > msgCreatedAt) return false;
    return true;
  });
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
    const mapped = dedupeToolParts((storedParts as MessagePart[]).map((p) => {
      if (p.type === 'text' && p.content) {
        return { ...p, content: repairStreamTextGlitches(stripToolNoise(p.content, { trim: false })) };
      }
      if (p.type === 'tool' && p.tool) return { ...p, tool: { ...p.tool, status: p.tool.status || 'done' } };
      if (p.type === 'questionnaire' && p.questionnaire) return p;
      return p;
    }), true);
    if (!shouldRebuildStoredParts(content, mapped, toolCalls)) {
      return { content, parts: mapped, toolCalls };
    }
  }

  if (sessionParts && sessionParts.length > 0) {
    const parts = buildPartsFromDbRows(sessionParts, content, toolCalls);
    if (parts.length > 0 && !shouldRebuildStoredParts(content, parts, toolCalls)) {
      return { content, parts, toolCalls };
    }
  }

  if (toolCalls?.length || content) {
    const parts = rebuildPartsFromCanonical(content, toolCalls);
    return { content, parts: parts.length > 0 ? parts : undefined, toolCalls };
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
