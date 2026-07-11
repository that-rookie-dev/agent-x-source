import type { DeepSearchProgress, DeepSearchResultBundle } from '../types/deep-search.js';
import type { MessagePart } from './message-parts.js';

export interface DeepSearchPartPayload {
  toolCallId: string;
  bundle?: DeepSearchResultBundle | null;
  progress?: DeepSearchProgress;
  running?: boolean;
}

export function parseDeepSearchProgressLine(line: string): DeepSearchProgress | null {
  try {
    const parsed = JSON.parse(line) as { deepSearchProgress?: DeepSearchProgress };
    return parsed.deepSearchProgress ?? null;
  } catch {
    return null;
  }
}

export function parseDeepSearchProgressFromStream(streamOutput?: string): DeepSearchProgress | null {
  if (!streamOutput) return null;
  const lines = streamOutput.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const progress = parseDeepSearchProgressLine(lines[i]!);
    if (progress) return progress;
  }
  return null;
}

export function deepSearchBundleFromMetadata(meta?: Record<string, unknown>): DeepSearchResultBundle | null {
  const raw = meta?.deepSearch;
  if (!raw || typeof raw !== 'object' || !('results' in (raw as object))) return null;
  return raw as DeepSearchResultBundle;
}

export function upsertDeepSearchPart(parts: MessagePart[], payload: DeepSearchPartPayload): MessagePart[] {
  const existingIdx = parts.findIndex((p) => p.type === 'deep_search' && p.id === payload.toolCallId);
  const existing = existingIdx >= 0 ? parts[existingIdx] : undefined;
  const next: MessagePart = {
    type: 'deep_search',
    id: payload.toolCallId,
    deepSearch: {
      bundle: payload.bundle ?? existing?.deepSearch?.bundle,
      progress: payload.progress ?? existing?.deepSearch?.progress,
      running: payload.running ?? existing?.deepSearch?.running,
    },
  };
  // Update in place so the card keeps its position; moving it to the tail mid-stream
  // would push still-arriving assistant text into a new segment and split the message.
  if (existingIdx >= 0) {
    return [...parts.slice(0, existingIdx), next, ...parts.slice(existingIdx + 1)];
  }
  const toolIdx = parts.findIndex(
    (p) => p.type === 'tool' && (p.tool?.id === payload.toolCallId || p.id === payload.toolCallId),
  );
  if (toolIdx >= 0) {
    return [...parts.slice(0, toolIdx + 1), next, ...parts.slice(toolIdx + 1)];
  }
  return [...parts, next];
}

/** Merge consecutive text parts (separated only after non-text parts are lifted out). */
function mergeAdjacentTextParts(parts: MessagePart[]): MessagePart[] {
  const merged: MessagePart[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (p.type === 'text' && prev?.type === 'text') {
      merged[merged.length - 1] = { ...prev, content: (prev.content || '') + (p.content || '') };
    } else {
      merged.push(p);
    }
  }
  return merged;
}

/** Lift deepSearch metadata from tool parts/calls into dedicated message parts beside each tool. */
export function attachDeepSearchPartsFromTools(parts: MessagePart[], toolCalls?: Array<{ id: string; name: string; metadata?: Record<string, unknown>; streamOutput?: string }>): MessagePart[] {
  let next = parts.filter((p) => p.type !== 'deep_search');
  const seen = new Set<string>();

  const consider = (id: string, name: string, metadata?: Record<string, unknown>, streamOutput?: string) => {
    if (name !== 'deep_web_search' || seen.has(id)) return;
    const bundle = deepSearchBundleFromMetadata(metadata);
    const progress = (metadata?.deepSearchProgress as DeepSearchProgress | undefined)
      ?? parseDeepSearchProgressFromStream(streamOutput)
      ?? undefined;
    if (!bundle && !progress) return;
    seen.add(id);
    next = upsertDeepSearchPart(next, {
      toolCallId: id,
      bundle,
      progress,
      running: !bundle && !!progress,
    });
  };

  for (const p of parts) {
    if (p.type === 'tool' && p.tool?.name === 'deep_web_search') {
      consider(p.tool.id, p.tool.name, p.tool.metadata, (p.tool as { streamOutput?: string }).streamOutput);
    }
  }
  for (const t of toolCalls ?? []) {
    consider(t.id, t.name, t.metadata, t.streamOutput);
  }
  // Lifting deep_search parts out can leave two streamed text parts adjacent; rejoin them
  // so a single streamed answer never renders as two separate cards.
  return mergeAdjacentTextParts(next);
}

export function partitionPartsForRender<T extends { type: string }>(parts: T[]): { main: T[]; deepSearch: T[] } {
  const main: T[] = [];
  const deepSearch: T[] = [];
  for (const p of parts) {
    if (p.type === 'deep_search') deepSearch.push(p);
    else main.push(p);
  }
  return { main, deepSearch };
}

/** Keep each deep_search block adjacent to its matching deep_web_search tool. */
export function orderPartsForChatRender<T extends { type: string; id?: string; tool?: { id?: string } }>(parts: T[]): T[] {
  const deepSearchById = new Map<string, T>();
  const nonDeep: T[] = [];
  for (const p of parts) {
    if (p.type === 'deep_search' && p.id) {
      deepSearchById.set(p.id, p);
    } else {
      nonDeep.push(p);
    }
  }
  if (deepSearchById.size === 0) return parts;

  const ordered: T[] = [];
  const placed = new Set<string>();
  for (const p of nonDeep) {
    ordered.push(p);
    const toolId = p.type === 'tool' ? (p.tool?.id ?? p.id) : undefined;
    if (toolId && deepSearchById.has(toolId)) {
      ordered.push(deepSearchById.get(toolId)!);
      placed.add(toolId);
    }
  }
  for (const [id, part] of deepSearchById) {
    if (placed.has(id)) continue;
    const textIdx = ordered.findIndex((p) => p.type === 'text');
    if (textIdx >= 0) {
      ordered.splice(textIdx, 0, part);
    } else {
      ordered.push(part);
    }
  }
  return ordered;
}
