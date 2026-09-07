import type { DownloadProgress, DownloadResult } from '../types/download.js';
import type { MessagePart } from './message-parts.js';

export interface DownloadPartPayload {
  toolCallId: string;
  progress?: DownloadProgress;
  result?: DownloadResult;
  running?: boolean;
}

export function parseDownloadProgressLine(line: string): DownloadProgress | null {
  try {
    const parsed = JSON.parse(line) as { downloadProgress?: DownloadProgress };
    return parsed.downloadProgress ?? null;
  } catch {
    return null;
  }
}

export function parseDownloadProgressFromStream(streamOutput?: string): DownloadProgress | null {
  if (!streamOutput) return null;
  const lines = streamOutput.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const progress = parseDownloadProgressLine(lines[i]!);
    if (progress) return progress;
  }
  return null;
}

export function downloadResultFromMetadata(meta?: Record<string, unknown>): DownloadResult | undefined {
  const raw = meta?.download;
  if (!raw || typeof raw !== 'object' || !('url' in (raw as object))) return undefined;
  return raw as DownloadResult;
}

export function upsertDownloadPart(parts: MessagePart[], payload: DownloadPartPayload): MessagePart[] {
  const existingIdx = parts.findIndex((p) => p.type === 'download' && p.id === payload.toolCallId);
  const existing = existingIdx >= 0 ? parts[existingIdx] : undefined;
  const next: MessagePart = {
    type: 'download',
    id: payload.toolCallId,
    download: {
      progress: payload.progress ?? existing?.download?.progress,
      result: payload.result ?? existing?.download?.result,
      running: payload.running ?? existing?.download?.running,
    },
  };
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

/** Lift download metadata from tool parts/calls into dedicated message parts. */
export function attachDownloadPartsFromTools(
  parts: MessagePart[],
  toolCalls?: Array<{ id: string; name: string; metadata?: Record<string, unknown>; streamOutput?: string }>,
): MessagePart[] {
  let next = parts.filter((p) => p.type !== 'download');
  const seen = new Set<string>();

  const consider = (id: string, name: string, metadata?: Record<string, unknown>, streamOutput?: string) => {
    if (name !== 'http_download' || seen.has(id)) return;
    const result = downloadResultFromMetadata(metadata);
    const progress = (metadata?.downloadProgress as DownloadProgress | undefined)
      ?? parseDownloadProgressFromStream(streamOutput)
      ?? undefined;
    if (!result && !progress) return;
    seen.add(id);
    next = upsertDownloadPart(next, {
      toolCallId: id,
      result,
      progress,
      running: !result && !!progress,
    });
  };

  for (const p of parts) {
    if (p.type === 'tool' && p.tool?.name === 'http_download') {
      consider(p.tool.id, p.tool.name, p.tool.metadata, (p.tool as { streamOutput?: string }).streamOutput);
    }
  }
  for (const t of toolCalls ?? []) {
    consider(t.id, t.name, t.metadata, t.streamOutput);
  }
  return next;
}
