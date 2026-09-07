import { describe, it, expect } from 'vitest';
import {
  upsertDownloadPart,
  attachDownloadPartsFromTools,
  parseDownloadProgressFromStream,
  downloadResultFromMetadata,
} from '../src/utils/download-parts.js';
import type { MessagePart } from '../src/utils/message-parts.js';
import type { DownloadProgress, DownloadResult } from '../src/types/download.js';

function makeToolPart(id: string, name: string, meta?: Record<string, unknown>, streamOutput?: string): MessagePart {
  return {
    type: 'tool',
    id,
    tool: { id, name, status: 'running', metadata: meta, streamOutput },
  };
}

describe('download-parts', () => {
  it('upserts a new download part beside its tool', () => {
    const tool = makeToolPart('t1', 'http_download');
    const progress: DownloadProgress = { phase: 'downloading', message: 'downloading file', percent: 23, outputPath: 'file.zip' };
    const parts = upsertDownloadPart([tool, { type: 'text', id: 'x', content: 'hello' }], { toolCallId: 't1', progress, running: true });
    expect(parts.map((p) => p.type)).toEqual(['tool', 'download', 'text']);
    expect((parts[1] as MessagePart).download?.progress?.percent).toBe(23);
  });

  it('updates in place so the card keeps its position', () => {
    const tool = makeToolPart('t1', 'http_download');
    const download: MessagePart = { type: 'download', id: 't1', download: { progress: { phase: 'downloading', message: 'x', percent: 10 } } };
    const result: DownloadResult = { url: 'http://x', outputPath: 'file.zip', size: 1234, filename: 'file.zip' };
    const parts = upsertDownloadPart([tool, download], { toolCallId: 't1', result, running: false });
    expect(parts).toHaveLength(2);
    expect(parts[1]?.download?.result?.size).toBe(1234);
    expect(parts[1]?.download?.progress?.percent).toBe(10);
  });

  it('parses progress from stream output', () => {
    const stream = 'abc\n{"downloadProgress":{"phase":"downloading","message":"x","percent":55}}\n';
    const progress = parseDownloadProgressFromStream(stream);
    expect(progress?.percent).toBe(55);
  });

  it('extracts result from metadata', () => {
    const meta = { download: { url: 'http://x', outputPath: 'out.bin', size: 99, filename: 'out.bin' } };
    const result = downloadResultFromMetadata(meta);
    expect(result?.size).toBe(99);
  });

  it('returns undefined for missing metadata', () => {
    expect(downloadResultFromMetadata(undefined)).toBeUndefined();
    expect(downloadResultFromMetadata({})).toBeUndefined();
    expect(downloadResultFromMetadata({ download: {} })).toBeUndefined();
  });

  it('lifts download parts from tool calls', () => {
    const tool = makeToolPart('t2', 'http_download', { download: { url: 'http://x', outputPath: 'out.bin', size: 99, filename: 'out.bin' } });
    const parts = attachDownloadPartsFromTools([tool], [{ id: 't2', name: 'http_download', metadata: tool.tool!.metadata }]);
    const downloadPart = parts.find((p) => p.type === 'download');
    expect(downloadPart).toBeDefined();
    expect(downloadPart?.download?.result?.size).toBe(99);
    expect(downloadPart?.download?.running).toBe(false);
  });
});
