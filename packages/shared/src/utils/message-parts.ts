import { stripToolNoise } from './text-sanitize.js';
import { appendStreamText, repairStreamTextGlitches } from './stream-text.js';
import { attachDeepSearchPartsFromTools } from './deep-search-parts.js';
import { attachChartPartsFromTools } from './chart-parts.js';
import type { StorableMessage } from '../types/storage.js';

export interface PersistedToolCall {
  id: string;
  name: string;
  args?: string | Record<string, unknown>;
  result?: string;
  status: 'running' | 'done' | 'error';
  elapsed?: number;
  metadata?: Record<string, unknown>;
}

import type { QuestionnaireRecord } from '../types/questionnaire.js';
import type { CrewRosterPickerRecord } from '../types/crew-roster-picker.js';
import type { DeepSearchProgress, DeepSearchResultBundle } from '../types/deep-search.js';

export interface MessagePart extends Record<string, unknown> {
  type: 'text' | 'tool' | 'subagent' | 'questionnaire' | 'crew_roster_picker' | 'deep_search' | 'chart' | 'thinking';
  id: string;
  content?: string;
  questionnaire?: QuestionnaireRecord;
  crewRosterPicker?: CrewRosterPickerRecord;
  /** Canonical ChartSpec JSON string for structured chart parts. */
  chartJson?: string;
  deepSearch?: {
    bundle?: DeepSearchResultBundle;
    progress?: DeepSearchProgress;
    running?: boolean;
  };
  tool?: PersistedToolCall;
  agent?: {
    id: string;
    name: string;
    task: string;
    status: 'running' | 'done' | 'error';
    result?: string;
    kind?: 'sub_agent' | 'crew_worker';
    toolCalls?: PersistedToolCall[];
  };
}

export type PersistedSubAgent = NonNullable<MessagePart['agent']>;

function parseMetadata(msg: Record<string, unknown> | StorableMessage): Record<string, unknown> {
  const raw = (msg as Record<string, unknown>)['metadata'];
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

export function isReasoningPartType(type: string): boolean {
  return type === 'reasoning-delta'
    || type === 'thinking-delta'
    || type === 'reasoning'
    || type === 'thinking';
}

/** Reconstruct thinking text from message metadata or persisted reasoning/thinking part rows. */
export function extractThinkingFromMessage(
  msg: Record<string, unknown> | StorableMessage,
  sessionParts?: DbPartRow[],
): string | undefined {
  const meta = parseMetadata(msg);
  const fromMeta = typeof meta['thinking'] === 'string' ? meta['thinking'].trim() : '';
  if (fromMeta) return fromMeta;
  const fromField = typeof (msg as Record<string, unknown>)['thinking'] === 'string'
    ? String((msg as Record<string, unknown>)['thinking']).trim()
    : '';
  if (fromField) return fromField;

  let buf = '';
  for (const p of sessionParts ?? []) {
    if (isReasoningPartType(String(p['type'] || ''))) {
      buf += String(p['content'] || '');
    }
  }
  const trimmed = buf.trim();
  return trimmed || undefined;
}

/** Prefer a short paragraph (~2 lines) before sealing into a new ThoughtCollapse. */
const MIN_THOUGHT_CHARS = 220;
/** Soft ceiling — seal even without a terminator so thoughts don't grow unboundedly. */
const SOFT_THOUGHT_CHARS = 420;

/** True when a thought looks cut off mid-sentence (avoid splitting into a new ThoughtCollapse). */
function looksIncompleteThought(content: string): boolean {
  const t = content.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  // Keep accumulating until we have a decent paragraph, unless forced (response text / reasoning_end).
  if (t.length < MIN_THOUGHT_CHARS) return true;
  // Ends with sentence/clause terminator → complete enough to seal as its own block.
  if (/[.!?…]"?$/.test(t)) return false;
  if (/[:;—–]\s*$/.test(t)) return true;
  // Long enough paragraph-ish block (newline or soft ceiling) may seal without a terminator.
  if (t.length >= SOFT_THOUGHT_CHARS || /\n\s*\n/.test(content) || (t.length >= MIN_THOUGHT_CHARS && /\n/.test(content))) {
    return false;
  }
  // Starts next delta lowercase often continues prior sentence — treat prior as incomplete.
  return true;
}

/** Append a reasoning delta into parts: merge into the trailing open thinking part, else start a new one. */
export function appendThinkingDeltaToParts(
  parts: MessagePart[],
  delta: string,
): MessagePart[] {
  if (!delta) return parts;
  const last = parts[parts.length - 1];
  if (last?.type === 'thinking' && !last['sealed']) {
    return [
      ...parts.slice(0, -1),
      { ...last, content: appendStreamText(last.content || '', delta) },
    ];
  }
  // Resume an incomplete sealed thought instead of starting a mid-sentence fragment.
  if (last?.type === 'thinking' && last['sealed'] && looksIncompleteThought(last.content || '')) {
    return [
      ...parts.slice(0, -1),
      {
        ...last,
        sealed: false,
        content: appendStreamText(last.content || '', delta),
      },
    ];
  }
  // Delta continues a prior incomplete thought even if another part slipped in between
  // (e.g. premature seal before real text) — prefer merging over orphan "The" blocks.
  const trimmedDelta = delta.replace(/^\s+/, '');
  if (trimmedDelta && /^[a-z0-9("`'[…]/.test(trimmedDelta)) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p?.type !== 'thinking') continue;
      if (!looksIncompleteThought(p.content || '')) break;
      const merged = {
        ...p,
        sealed: false,
        content: appendStreamText(p.content || '', delta),
      };
      return [...parts.slice(0, i), merged, ...parts.slice(i + 1)];
    }
  }
  return [...parts, { type: 'thinking', id: crypto.randomUUID(), content: delta }];
}

/** Close the current thinking phase so the next delta becomes a new ThoughtCollapse. */
export function sealTrailingThinkingPart(parts: MessagePart[], opts?: { force?: boolean }): MessagePart[] {
  const last = parts[parts.length - 1];
  if (last?.type !== 'thinking' || last['sealed']) return parts;
  // Don't seal mid-sentence unless forced (reasoning_end / turn complete).
  if (!opts?.force && looksIncompleteThought(last.content || '')) return parts;
  return [...parts.slice(0, -1), { ...last, sealed: true }];
}

/** Pull sub-agent cards from message parts and/or metadata.subAgents. */
export function extractSubAgentsFromMessage(
  msg: Record<string, unknown> | StorableMessage,
  parts?: MessagePart[],
): PersistedSubAgent[] {
  const byId = new Map<string, PersistedSubAgent>();
  for (const p of parts ?? []) {
    if (p.type !== 'subagent' || !p.agent?.id) continue;
    byId.set(p.agent.id, {
      ...p.agent,
      status: p.agent.status || 'done',
      kind: p.agent.kind ?? 'sub_agent',
    });
  }
  const meta = parseMetadata(msg);
  const raw = meta['subAgents'] ?? (msg as Record<string, unknown>)['subAgents'];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = String(rec['id'] || '').trim();
      if (!id) continue;
      const statusRaw = String(rec['status'] || 'done').toLowerCase();
      const status: PersistedSubAgent['status'] =
        statusRaw === 'error' || statusRaw === 'failed' ? 'error'
          : statusRaw === 'running' ? 'running'
            : 'done';
      const prev = byId.get(id);
      byId.set(id, {
        id,
        name: String(rec['name'] || prev?.name || 'Sub-Agent'),
        task: String(rec['task'] || prev?.task || ''),
        status,
        result: typeof rec['result'] === 'string' ? rec['result'] : prev?.result,
        kind: (rec['kind'] as PersistedSubAgent['kind']) || prev?.kind || 'sub_agent',
      });
    }
  }
  return [...byId.values()];
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
    } else if (p.type === 'thinking' && p.content) {
      const prev = merged[merged.length - 1];
      if (prev?.type === 'thinking') {
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
    } else if (partType === 'subagent' || partType === 'sub-agent') {
      const id = String(p['tool_call_id'] || p['id'] || crypto.randomUUID());
      if (built.some((b) => b.type === 'subagent' && b.agent?.id === id)) continue;
      const args = parseJsonField(p['tool_args']);
      const argsObj = args && typeof args === 'object' ? args as Record<string, unknown> : {};
      const statusRaw = String(
        p['tool_success'] === 0 || p['tool_success'] === false
          ? 'error'
          : (argsObj['status'] || 'done'),
      ).toLowerCase();
      built.push({
        type: 'subagent',
        id,
        agent: {
          id,
          name: String(argsObj['name'] || p['tool_name'] || 'Sub-Agent'),
          task: String(p['content'] || argsObj['task'] || ''),
          status: statusRaw === 'error' || statusRaw === 'failed'
            ? 'error'
            : statusRaw === 'running'
              ? 'running'
              : 'done',
          result: typeof p['tool_result'] === 'string' ? p['tool_result'] : undefined,
          kind: (argsObj['kind'] as 'sub_agent' | 'crew_worker') || 'sub_agent',
        },
      });
    } else if (isReasoningPartType(partType) && p['content']) {
      const delta = String(p['content']);
      const prev = built[built.length - 1];
      if (prev?.type === 'thinking') {
        prev.content = appendStreamText(prev.content || '', delta);
      } else {
        built.push({ type: 'thinking', id: crypto.randomUUID(), content: delta });
      }
    }
  }

  let parts = mergeTextParts(built.filter((p) => {
    if (p.type === 'text') return !!(p.content && p.content.trim());
    if (p.type === 'thinking') return !!(p.content && p.content.trim());
    if (p.type === 'tool') return !!p.tool;
    return true;
  }));

  parts = parts.map((p) => {
    if (p.type === 'text' && p.content) {
      return { ...p, content: repairStreamTextGlitches(stripToolNoise(p.content, { trim: false })) };
    }
    if (p.type === 'thinking' && p.content) {
      return { ...p, content: repairStreamTextGlitches(p.content) };
    }
    return p;
  });

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
  messages: Array<Record<string, unknown> | StorableMessage>,
  allParts: DbPartRow[],
  assistantIndex: number,
): DbPartRow[] {
  const msg = messages[assistantIndex]!;
  const msgCreatedAt = ((msg['created_at'] as string) ?? (msg['createdAt'] as string)) || '';

  let prevUserCreatedAt = '';
  for (let j = assistantIndex - 1; j >= 0; j--) {
    if (messages[j]!['role'] === 'user') {
      prevUserCreatedAt = ((messages[j]!['created_at'] as string) ?? (messages[j]!['createdAt'] as string)) || '';
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

function withThinkingAndSubAgents(
  msg: Record<string, unknown> | StorableMessage,
  sessionParts: DbPartRow[] | undefined,
  base: { content: string; parts?: MessagePart[]; toolCalls?: PersistedToolCall[] },
): {
  content: string;
  parts?: MessagePart[];
  toolCalls?: PersistedToolCall[];
  thinking?: string;
  subAgents?: PersistedSubAgent[];
} {
  const thinking = extractThinkingFromMessage(msg, sessionParts);
  let parts = base.parts;
  // Legacy: metadata/field blob with no chronological thinking parts → one block before body.
  if (thinking && !(parts ?? []).some((p) => p.type === 'thinking')) {
    parts = [
      { type: 'thinking' as const, id: crypto.randomUUID(), content: thinking },
      ...(parts ?? []),
    ];
  }
  const subAgents = extractSubAgentsFromMessage(msg, parts);
  if (subAgents.length > 0) {
    const existing = new Set((parts ?? []).filter((p) => p.type === 'subagent').map((p) => p.agent?.id));
    const missing = subAgents.filter((a) => !existing.has(a.id));
    if (missing.length > 0) {
      parts = [
        ...(parts ?? []),
        ...missing.map((agent) => ({ type: 'subagent' as const, id: agent.id, agent })),
      ];
    }
  }
  return {
    ...base,
    parts,
    ...(thinking ? { thinking } : {}),
    ...(subAgents.length > 0 ? { subAgents } : {}),
  };
}

/** Normalize stored parts JSON or reconstruct from toolCalls. */
export function normalizeMessageForUi(msg: Record<string, unknown> | StorableMessage, sessionParts?: DbPartRow[]): {
  content: string;
  parts?: MessagePart[];
  toolCalls?: PersistedToolCall[];
  thinking?: string;
  subAgents?: PersistedSubAgent[];
} {
  const rawContent = (msg['content'] as string) || '';
  const content = repairStreamTextGlitches(stripToolNoise(rawContent));

  let toolCalls: PersistedToolCall[] | undefined;
  const rawTools = msg['toolCalls'];
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

  const hasReasoningRows = (sessionParts ?? []).some((p) => isReasoningPartType(String(p['type'] || '')));

  const storedParts = msg['parts'];
  if (Array.isArray(storedParts) && storedParts.length > 0) {
    const mapped = dedupeToolParts((storedParts as MessagePart[]).map((p) => {
      if (p.type === 'text' && p.content) {
        return { ...p, content: repairStreamTextGlitches(stripToolNoise(p.content, { trim: false })) };
      }
      if (p.type === 'thinking' && p.content) {
        return { ...p, content: repairStreamTextGlitches(p.content) };
      }
      if (p.type === 'tool' && p.tool) return { ...p, tool: { ...p.tool, status: p.tool.status || 'done' } };
      if (p.type === 'subagent' && p.agent) {
        return {
          ...p,
          agent: {
            ...p.agent,
            status: p.agent.status || 'done',
            kind: p.agent.kind ?? 'sub_agent',
          },
        };
      }
      if (p.type === 'questionnaire' && p.questionnaire) return p;
      if (p.type === 'crew_roster_picker' && p.crewRosterPicker) return p;
      if (p.type === 'deep_search' && p.deepSearch) return p;
      if (p.type === 'chart' && p.chartJson) return p;
      return p;
    }), true);
    // Prefer DB chronology when reasoning rows exist but stored parts lack thinking segments.
    const missingThinkingChronology = hasReasoningRows && !mapped.some((p) => p.type === 'thinking');
    if (!shouldRebuildStoredParts(content, mapped, toolCalls) && !missingThinkingChronology) {
      return withThinkingAndSubAgents(msg, sessionParts, {
        content,
        parts: attachChartPartsFromTools(attachDeepSearchPartsFromTools(mapped, toolCalls), toolCalls),
        toolCalls,
      });
    }
  }

  if (sessionParts && sessionParts.length > 0) {
    const parts = buildPartsFromDbRows(sessionParts, content, toolCalls);
    // Rows often carry tools that aren't mirrored on the message toolCalls field yet.
    const rowTools = parts
      .filter((p): p is MessagePart & { tool: PersistedToolCall } => p.type === 'tool' && !!p.tool)
      .map((p) => p.tool);
    const effectiveTools = toolCalls?.length ? toolCalls : (rowTools.length ? rowTools : undefined);
    if (parts.length > 0 && !shouldRebuildStoredParts(content, parts, effectiveTools)) {
      return withThinkingAndSubAgents(msg, sessionParts, {
        content,
        parts: attachChartPartsFromTools(attachDeepSearchPartsFromTools(parts, effectiveTools), effectiveTools),
        toolCalls: effectiveTools,
      });
    }
  }

  if (toolCalls?.length || content) {
    const parts = rebuildPartsFromCanonical(content, toolCalls);
    return withThinkingAndSubAgents(msg, sessionParts, {
      content,
      parts: parts.length > 0
        ? attachChartPartsFromTools(attachDeepSearchPartsFromTools(parts, toolCalls), toolCalls)
        : undefined,
      toolCalls,
    });
  }

  return withThinkingAndSubAgents(msg, sessionParts, { content, toolCalls });
}

/** Build parts array for session persistence from turn accumulators. */
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
