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
  const without = parts.filter((p) => !(p.type === 'deep_search' && p.id === payload.toolCallId));
  const existing = parts.find((p) => p.type === 'deep_search' && p.id === payload.toolCallId);
  const next: MessagePart = {
    type: 'deep_search',
    id: payload.toolCallId,
    deepSearch: {
      bundle: payload.bundle ?? existing?.deepSearch?.bundle,
      progress: payload.progress ?? existing?.deepSearch?.progress,
      running: payload.running ?? existing?.deepSearch?.running,
    },
  };
  return [...without, next];
}

/** Lift deepSearch metadata from tool parts/calls into dedicated message parts (always last). */
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
  return next;
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

/** Place deep_search blocks after the last tool and before the first assistant text. */
export function orderPartsForChatRender<T extends { type: string }>(parts: T[]): T[] {
  const deepSearch = parts.filter((p) => p.type === 'deep_search');
  if (deepSearch.length === 0) return parts;

  const nonDeep = parts.filter((p) => p.type !== 'deep_search');
  if (nonDeep.length === 0) return deepSearch;

  let lastToolIdx = -1;
  for (let i = nonDeep.length - 1; i >= 0; i--) {
    if (nonDeep[i]!.type === 'tool') {
      lastToolIdx = i;
      break;
    }
  }

  const firstTextIdx = nonDeep.findIndex((p) => p.type === 'text');
  const insertAt = lastToolIdx >= 0
    ? lastToolIdx + 1
    : firstTextIdx >= 0
      ? firstTextIdx
      : nonDeep.length;

  return [
    ...nonDeep.slice(0, insertAt),
    ...deepSearch,
    ...nonDeep.slice(insertAt),
  ];
}
