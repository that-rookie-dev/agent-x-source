import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpGet, httpRequest, webScrape } from '../../src/tools/builtin/web.js';
import type { ToolExecutionContext } from '@agentx/shared';

function toStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function mockResponse(overrides: Partial<Response> & { bodyText?: string } = {}): Response {
  const bodyText = overrides.bodyText ?? '';
  const text = async () => bodyText;
  const json = async () => JSON.parse(bodyText);
  const body = toStream(bodyText);
  delete (overrides as { bodyText?: string }).bodyText;
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map() as unknown as Headers,
    body,
    text,
    json,
    ...overrides,
  } as Response;
}

function mockFetchWithResponse(response: Response) {
  globalThis.fetch = vi.fn(async () => response);
}

describe('download guard on web tools', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {});
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('blocks http_get on a binary file URL', async () => {
    const headers = new Map<string, string | null>([['content-type', 'application/octet-stream'], ['content-length', '136314880']]);
    mockFetchWithResponse(mockResponse({ bodyText: 'binary', headers: headers as unknown as Headers }));
    const result = await httpGet({ url: 'https://example.com/model.litertlm' }, { sessionId: 's1', scopePath: '/tmp', timeout: 30000 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('DOWNLOAD_BLOCKED');
  });

  it('allows http_get on a raw text source file', async () => {
    const headers = new Map<string, string | null>([['content-type', 'text/plain; charset=utf-8']]);
    mockFetchWithResponse(mockResponse({ bodyText: 'package com.example;', headers: headers as unknown as Headers }));
    const result = await httpGet({ url: 'https://raw.githubusercontent.com/x/y/Main.kt' }, { sessionId: 's1', scopePath: '/tmp', timeout: 30000 });
    expect(result.success).toBe(true);
  });

  it('blocks http_get when response is binary even if URL is not', async () => {
    const headers = new Map<string, string | null>([['content-type', 'application/octet-stream'], ['content-length', '1000000']]);
    mockFetchWithResponse(mockResponse({ bodyText: 'x', headers: headers as unknown as Headers }));
    const result = await httpGet({ url: 'https://example.com/some/path' }, { sessionId: 's1', scopePath: '/tmp', timeout: 30000 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('DOWNLOAD_BLOCKED');
  });

  it('blocks http_request GET on a binary file URL', async () => {
    const headers = new Map<string, string | null>([['content-type', 'application/zip'], ['content-length', '1000']]);
    mockFetchWithResponse(mockResponse({ bodyText: 'zip', headers: headers as unknown as Headers }));
    const result = await httpRequest({ url: 'https://example.com/archive.zip', method: 'GET' }, { sessionId: 's1', scopePath: '/tmp', timeout: 30000 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('DOWNLOAD_BLOCKED');
  });

  it('allows http_request HEAD on a binary file URL', async () => {
    const headers = new Map<string, string | null>([['content-type', 'application/octet-stream'], ['content-length', '136314880']]);
    mockFetchWithResponse({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: headers as unknown as Headers,
      body: null,
    } as unknown as Response);
    const result = await httpRequest({ url: 'https://example.com/model.litertlm', method: 'HEAD' }, { sessionId: 's1', scopePath: '/tmp', timeout: 30000 });
    expect(result.success).toBe(true);
    expect(result.output).toContain('HTTP/200');
  });

  it('blocks web_scrape on a binary file URL', async () => {
    const result = await webScrape({ url: 'https://example.com/model.litertlm' }, { sessionId: 's1', scopePath: '/tmp', timeout: 30000 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('DOWNLOAD_BLOCKED');
  });
});
