import { stripToolNoise } from './text-sanitize.js';
import { appendStreamText, repairStreamTextGlitches } from './stream-text.js';
import { attachDeepSearchPartsFromTools } from './deep-search-parts.js';
import { attachChartPartsFromTools } from './chart-parts.js';
import { attachDownloadPartsFromTools } from './download-parts.js';
import { attachVisualPartsFromTools } from './visual-parts.js';
import type { VisualItem } from '../types/visual.js';
import type { StorableMessage } from '../types/storage.js';
import {
  parseResponseDocument,
  responseDocumentToMarkdown,
  type ResponseDocumentV1,
} from './response-document.js';

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
import type { DownloadProgress, DownloadResult } from '../types/download.js';
import type { PermissionOutcomeRecord } from '../types/permission-outcome.js';

export interface MessagePart extends Record<string, unknown> {
  type: 'text' | 'tool' | 'subagent' | 'questionnaire' | 'crew_roster_picker' | 'deep_search' | 'download' | 'chart' | 'thinking' | 'permission' | 'response_document' | 'visual';
  id: string;
  content?: string;
  questionnaire?: QuestionnaireRecord;
  crewRosterPicker?: CrewRosterPickerRecord;
  /** Completed permission decision chip for chat history. */
  permission?: PermissionOutcomeRecord;
  /** Canonical ChartSpec JSON string for structured chart parts. */
  chartJson?: string;
  /** Shared visual stage item (image / video / document / url). */
  visual?: VisualItem;
  /** Validated, renderer-safe rich final response document. */
  responseDocument?: ResponseDocumentV1;
  /** Canonical portable fallback used for invalid versions and export. */
  fallbackMarkdown?: string;
  deepSearch?: {
    bundle?: DeepSearchResultBundle;
    progress?: DeepSearchProgress;
    running?: boolean;
  };
  /** Download tool progress / result card. */
  download?: {
    progress?: DownloadProgress;
    result?: DownloadResult;
    running?: boolean;
  };
  tool?: PersistedToolCall;
  agent?: {
    id: string;
    name: string;
    task: string;
    status: 'running' | 'done' | 'error' | 'admitted';
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

/** Keep one response document per stable part id, preferring the latest snapshot. */
export function dedupeResponseDocumentParts(parts: MessagePart[]): MessagePart[] {
  const result: MessagePart[] = [];
  const indexById = new Map<string, number>();
  for (const part of parts) {
    if (part.type !== 'response_document') {
      result.push(part);
      continue;
    }
    const existingIndex = indexById.get(part.id);
    if (existingIndex == null) {
      indexById.set(part.id, result.length);
      result.push(part);
    } else {
      const existing = result[existingIndex];
      const existingRevision = existing?.type === 'response_document'
        ? (existing.responseDocument?.revision ?? 1)
        : 1;
      const incomingRevision = part.responseDocument?.revision ?? 1;
      if (incomingRevision >= existingRevision) result[existingIndex] = part;
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
      // Push text at the end — the final response typically comes after all
      // tool calls. Using unshift would place it before tools, which is
      // almost never the correct chronological position.
      parts.push({ type: 'text', id: crypto.randomUUID(), content: clean });
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

/** True when parts text is a truncated prefix of the canonical message content. */
export function partsTextTruncatesContent(content: string, parts: MessagePart[]): boolean {
  const partsText = stripToolNoise(textFromParts(parts), { trim: false });
  const cleanContent = stripToolNoise(content, { trim: false });
  if (!cleanContent) return false;
  const hasValidResponseDocument = parts.some((part) => (
    part.type === 'response_document'
    && parseResponseDocument(part.responseDocument).ok
  ));
  if (!partsText && hasValidResponseDocument) return false;
  if (!partsText) return true;
  if (cleanContent.length <= partsText.length + 8) return false;
  // Classic coalesce race: UI kept a prefix of the finished assistant text.
  if (cleanContent.startsWith(partsText)) return true;
  // Parts collapsed mid-sentence while content holds the finished reply.
  const lead = Math.min(48, partsText.length);
  return lead >= 16
    && cleanContent.includes(partsText.slice(0, lead))
    && partsText.length / cleanContent.length < 0.9;
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
  if (partsTextTruncatesContent(content, parts)) return true;
  return false;
}

export function rebuildPartsFromCanonical(content: string, toolCalls?: PersistedToolCall[]): MessagePart[] {
  // Place tools first, then text at the end. This is a last-resort rebuild
  // when we have no chronological ordering information. In practice, the
  // final text response from the LLM comes after all tool calls, so putting
  // text last is a better default than putting it first. The chronological
  // ordering is preserved by the earlier code paths that use stored parts
  // or DB rows; this fallback only triggers when those are unavailable or
  // corrupted.
  return dedupeToolParts([
    ...(toolCalls ?? []).map((t) => ({
      type: 'tool' as const,
      id: t.id,
      tool: { ...t, status: t.status || 'done' as const },
    })),
    ...(content ? [{ type: 'text' as const, id: crypto.randomUUID(), content }] : []),
  ], true);
}

function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Same-turn near-duplicate: two complete replies that restate the same answer. */
export function textsNearDuplicate(a: string | undefined, b: string | undefined): boolean {
  if (textsOverlap(a, b)) return true;
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if (left.length < 80 || right.length < 80) return false;
  const ratio = left.length < right.length ? left.length / right.length : right.length / left.length;
  if (ratio < 0.45) return false;
  const ta = significantTokens(left).slice(0, 48);
  const tb = significantTokens(right).slice(0, 48);
  if (ta.length < 8 || tb.length < 8) return false;
  const setA = new Set(ta);
  let inter = 0;
  for (const t of tb) {
    if (setA.has(t)) inter += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  const leadA = ta.slice(0, 16);
  const leadB = tb.slice(0, 16);
  const leadInter = leadB.filter((t) => leadA.includes(t)).length;
  return (inter >= 8 && union > 0 && inter / union >= 0.4) || leadInter >= 7;
}

/** True when two assistant texts are the same reply (exact, prefix, or shared lead). */
export function textsOverlap(a: string | undefined, b: string | undefined): boolean {
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.startsWith(right) || right.startsWith(left)) return true;
  const lead = Math.min(64, left.length, right.length);
  if (lead < 24) return false;
  return left.slice(0, lead) === right.slice(0, lead);
}

/**
 * Keep one copy when a turn stored multiple overlapping text parts
 * (draft, then tools, then a revised draft of the same report).
 * Later drafts win unless they are a truncated prefix of an earlier one.
 */
export function collapseOverlappingTextParts<T extends { type?: string; content?: string }>(parts: T[]): T[] {
  if (parts.length < 2) return parts;
  const out: T[] = [];
  let lastText: T | null = null;
  for (const part of parts) {
    if (part.type !== 'text' || !part.content?.trim()) {
      out.push(part);
      continue;
    }
    if (lastText && textsNearDuplicate(lastText.content, part.content)) {
      const prev = lastText.content || '';
      const next = part.content || '';
      const nextIsPrefix = prev.startsWith(next) && prev.length > next.length;
      if (nextIsPrefix) continue;
      const idx = out.lastIndexOf(lastText);
      if (idx >= 0) out[idx] = part;
      lastText = part;
      continue;
    }
    lastText = part;
    out.push(part);
  }
  return out;
}

export function textFromAssistantRecord(msg: {
  content?: unknown;
  parts?: Array<{ type?: string; content?: string }> | unknown;
}): string {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  const fromParts = collapseOverlappingTextParts(
    parts.filter((p): p is { type: string; content?: string } => !!p && typeof p === 'object'),
  )
    .filter((p) => p.type === 'text' && p.content)
    .map((p) => String(p.content || ''))
    .join('');
  const content = typeof msg.content === 'string' ? msg.content : '';
  return (fromParts || content).trim();
}

/**
 * Drop text from earlier assistant messages when a later one is the same report.
 * Tools / thinking on the earlier row stay so the workflow accordion remains.
 */
export function suppressOverlappingAssistantTexts<T extends {
  role?: string;
  content?: string;
  parts?: Array<{ type?: string; content?: string }>;
  thinking?: string;
  toolCalls?: unknown[];
  subAgents?: unknown[];
  plan?: unknown;
}>(messages: T[]): T[] {
  const assistantIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'assistant') assistantIdx.push(i);
  }
  if (assistantIdx.length < 2) return messages;
  const next = messages.slice();
  for (let k = 1; k < assistantIdx.length; k++) {
    const prevI = assistantIdx[k - 1]!;
    const curI = assistantIdx[k]!;
    const prev = next[prevI]!;
    const cur = next[curI]!;
    const prevText = textFromAssistantRecord(prev);
    const curText = textFromAssistantRecord(cur);
    if (!textsOverlap(prevText, curText)) continue; // not textsNearDuplicate — later turns may restyle the same table on request
    next[prevI] = {
      ...prev,
      content: '',
      parts: (prev.parts ?? []).filter((p) => p.type !== 'text' && p.type !== 'response_document'),
    };
  }
  return next.filter((m) => {
    if (m.role !== 'assistant') return true;
    if (textFromAssistantRecord(m)) return true;
    if (typeof m.thinking === 'string' && m.thinking.trim()) return true;
    if (m.toolCalls?.length) return true;
    if (m.subAgents?.length) return true;
    if (m.plan) return true;
    return (m.parts ?? []).some((p) => p.type && p.type !== 'text');
  });
}

/** True when restore/live parts still have an in-flight tool. */
export function partsIndicateRunningTools(parts: Array<Record<string, unknown>> | undefined): boolean {
  if (!parts?.length) return false;
  return parts.some((p) => {
    const tool = p.tool && typeof p.tool === 'object' ? p.tool as Record<string, unknown> : null;
    const status = String(p.status ?? tool?.status ?? p.tool_status ?? '').toLowerCase();
    return status === 'running' || status === 'pending' || status === 'in_progress';
  });
}

/** Persisted answer already matches a still-flagged live turn — do not replay it. */
export function isSettledPersistedTurn(opts: {
  phase?: string | null;
  partialContent?: string | null;
  lastAssistantText?: string | null;
  hasRunningTools?: boolean;
}): boolean {
  if (opts.hasRunningTools) return false;
  const phase = opts.phase ?? '';
  if (phase && phase !== 'running' && phase !== 'working') return false;
  const partial = (opts.partialContent ?? '').trim();
  const last = (opts.lastAssistantText ?? '').trim();
  if (!partial || !last) return false;
  if (!textsOverlap(last, partial)) return false;
  return last.length >= Math.max(0, partial.length - 32);
}

/**
 * Align live streaming text parts with the canonical finished assistant content.
 * Fixes the coalesce race where message_received arrives before the last
 * stream_chunk flush, leaving parts as a truncated prefix of `content`.
 */
export function syncTextPartsWithCanonicalContent(
  parts: MessagePart[] | undefined,
  canonical: string,
): MessagePart[] {
  const content = canonical ?? '';
  if (!content.trim()) return parts?.length ? parts : [];

  if (!parts?.length) {
    return [{ type: 'text', id: crypto.randomUUID(), content }];
  }

  // A validated rich document is the final presentation. Do not re-inject a
  // duplicate Markdown text bubble beside it (live finalize race).
  const hasValidResponseDocument = parts.some((part) => (
    part.type === 'response_document'
    && parseResponseDocument(part.responseDocument).ok
  ));
  if (hasValidResponseDocument) {
    return parts.filter((part) => part.type !== 'text');
  }

  const textIdxs: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]!.type === 'text') textIdxs.push(i);
  }

  if (textIdxs.length === 0) {
    return [...parts, { type: 'text', id: crypto.randomUUID(), content }];
  }

  const joined = textIdxs.map((i) => parts[i]!.content || '').join('');
  if (joined === content) return parts;

  // Truncated stream: append the missing suffix onto the last text part.
  if (content.startsWith(joined) && content.length > joined.length) {
    const lastIdx = textIdxs[textIdxs.length - 1]!;
    const next = parts.slice();
    const prev = parts[lastIdx]!;
    next[lastIdx] = { ...prev, content: (prev.content || '') + content.slice(joined.length) };
    return next;
  }

  // Single text bubble — content is authoritative.
  if (textIdxs.length === 1) {
    const lastIdx = textIdxs[0]!;
    const next = parts.slice();
    next[lastIdx] = { ...parts[lastIdx]!, content };
    return next;
  }

  // Interleaved text/tools: keep earlier text segments, put remainder in the last text part.
  let prefixLen = 0;
  for (let t = 0; t < textIdxs.length - 1; t++) {
    prefixLen += (parts[textIdxs[t]!]!.content || '').length;
  }
  const prefix = joined.slice(0, prefixLen);
  if (prefixLen === 0 || content.startsWith(prefix)) {
    const lastIdx = textIdxs[textIdxs.length - 1]!;
    const next = parts.slice();
    next[lastIdx] = { ...parts[lastIdx]!, content: content.slice(prefixLen) };
    return next;
  }

  // Fallback: preserve tools/questionnaires; one canonical text block at the end.
  const nonText = parts.filter((p) => p.type !== 'text');
  return [...nonText, { type: 'text', id: crypto.randomUUID(), content }];
}

/**
 * Detect when persisted parts[] accumulated prior-turn content (parts grow across turns
 * but content holds the canonical single-turn text from message_received).
 */
export function partsCorruptedByCrossTurn(content: string, parts: MessagePart[]): boolean {
  // If parts have interleaved text and tools (text before AND after a tool),
  // this is a legitimate chronological ordering from streaming — not cross-turn
  // corruption. Cross-turn corruption always has all text at the start with no
  // interleaving (prior-turn prefix + current-turn text, then tools).
  if (hasInterleavedTextAndTools(parts)) return false;

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

/**
 * Detect when text parts appear both before AND after a non-text part (tool,
 * thinking, subagent, chart, deep_search). This is a clear signature of
 * legitimate chronological interleaving from live streaming — the LLM emitted
 * text, then called a tool, then emitted more text. Cross-turn corruption
 * (prior-turn prefix + current-turn text) never has this pattern because the
 * corrupted parts are all text-only with no interleaving.
 */
function hasInterleavedTextAndTools(parts: MessagePart[]): boolean {
  let firstTextIdx = -1;
  let lastTextIdx = -1;
  let firstNonTextIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.type === 'text' && p.content) {
      if (firstTextIdx < 0) firstTextIdx = i;
      lastTextIdx = i;
    } else {
      if (firstNonTextIdx < 0) firstNonTextIdx = i;
    }
  }
  // Need at least two text parts with a non-text part between them
  return firstTextIdx >= 0
    && lastTextIdx > firstTextIdx
    && firstNonTextIdx >= 0
    && firstNonTextIdx > firstTextIdx
    && firstNonTextIdx < lastTextIdx;
}

/** Assign message_parts rows to one assistant message (turn window: after prev user, through assistant). */
export function assignPartsToAssistantMessage(
  messages: Array<Record<string, unknown> | StorableMessage>,
  allParts: DbPartRow[],
  assistantIndex: number,
): DbPartRow[] {
  const msg = messages[assistantIndex]!;
  const messageId = String(msg['id'] ?? '');
  const msgCreatedAt = ((msg['created_at'] as string) ?? (msg['createdAt'] as string)) || '';

  let prevUserCreatedAt = '';
  for (let j = assistantIndex - 1; j >= 0; j--) {
    if (messages[j]!['role'] === 'user') {
      prevUserCreatedAt = ((messages[j]!['created_at'] as string) ?? (messages[j]!['createdAt'] as string)) || '';
      break;
    }
  }

  return allParts.filter((p) => {
    // A part linked to this message ID is authoritative even when its
    // created_at is a few milliseconds after the assistant row. This happens
    // when the stream part writer and final message writer commit concurrently.
    const partMessageId = String(p['message_id'] ?? p['messageId'] ?? '');
    if (messageId && partMessageId === messageId) return true;
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
  if (parts?.length) {
    parts = collapseOverlappingTextParts(parts);
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
  let content = repairStreamTextGlitches(stripToolNoise(rawContent));

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
    const mapped = collapseOverlappingTextParts(dedupeResponseDocumentParts(dedupeToolParts((storedParts as MessagePart[]).map((p) => {
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
      if (p.type === 'permission' && p.permission) return p;
      if (p.type === 'crew_roster_picker' && p.crewRosterPicker) return p;
      if (p.type === 'deep_search' && p.deepSearch) return p;
      if (p.type === 'chart' && p.chartJson) return p;
      if (p.type === 'visual' && p.visual) return p;
      if (p.type === 'response_document') {
        const parsed = parseResponseDocument(p.responseDocument);
        if (parsed.ok) {
          return {
            ...p,
            responseDocument: parsed.document,
            fallbackMarkdown: repairStreamTextGlitches(
              p.fallbackMarkdown?.trim()
              || responseDocumentToMarkdown(parsed.document),
            ),
          };
        }
        if (p.fallbackMarkdown?.trim()) {
          return { type: 'text' as const, id: p.id, content: p.fallbackMarkdown };
        }
      }
      return p;
    }), true)));
    const survivingText = mapped.filter((p) => p.type === 'text' && p.content?.trim());
    if (survivingText.length === 1 && content && textsNearDuplicate(content, survivingText[0]!.content)) {
      content = survivingText[0]!.content!;
    }
    // Prefer DB chronology when reasoning rows exist but stored parts lack thinking segments.
    const missingThinkingChronology = hasReasoningRows && !mapped.some((p) => p.type === 'thinking');
    if (!shouldRebuildStoredParts(content, mapped, toolCalls) && !missingThinkingChronology) {
      return withThinkingAndSubAgents(msg, sessionParts, {
        content,
        parts: attachVisualPartsFromTools(attachChartPartsFromTools(attachDownloadPartsFromTools(attachDeepSearchPartsFromTools(mapped, toolCalls), toolCalls), toolCalls)),
        toolCalls,
      });
    }
    // If the only reason for rebuild is text length differences (not cross-turn
    // corruption or tool ID mismatch), preserve the stored parts' chronological
    // ordering. Rebuilding from canonical content would merge all text into one
    // block and place it before all tools — destroying the interleaved
    // chronological order the user sees during live streaming.
    if (mapped.length > 0
      && !partsCorruptedByCrossTurn(content, mapped)
      && !partsToolIdsMismatch(mapped, toolCalls)
      && partsTextExceedsContent(content, mapped)
    ) {
      return withThinkingAndSubAgents(msg, sessionParts, {
        content,
        parts: attachVisualPartsFromTools(attachChartPartsFromTools(attachDownloadPartsFromTools(attachDeepSearchPartsFromTools(mapped, toolCalls), toolCalls), toolCalls)),
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
        parts: attachVisualPartsFromTools(attachChartPartsFromTools(attachDownloadPartsFromTools(attachDeepSearchPartsFromTools(parts, effectiveTools), effectiveTools), effectiveTools)),
        toolCalls: effectiveTools,
      });
    }
    // Same preservation check as above: if the only issue is text length
    // differences (not cross-turn corruption or tool ID mismatch), keep the
    // chronological ordering from the DB rows instead of falling through to
    // rebuildPartsFromCanonical which would merge all text into one block.
    if (parts.length > 0
      && !partsCorruptedByCrossTurn(content, parts)
      && !partsToolIdsMismatch(parts, effectiveTools)
      && partsTextExceedsContent(content, parts)
    ) {
      return withThinkingAndSubAgents(msg, sessionParts, {
        content,
        parts: attachVisualPartsFromTools(attachChartPartsFromTools(attachDownloadPartsFromTools(attachDeepSearchPartsFromTools(parts, effectiveTools), effectiveTools), effectiveTools)),
        toolCalls: effectiveTools,
      });
    }
  }

  if (toolCalls?.length || content) {
    const parts = rebuildPartsFromCanonical(content, toolCalls);
    return withThinkingAndSubAgents(msg, sessionParts, {
      content,
      parts: parts.length > 0
        ? attachVisualPartsFromTools(attachChartPartsFromTools(attachDownloadPartsFromTools(attachDeepSearchPartsFromTools(parts, toolCalls), toolCalls), toolCalls))
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
