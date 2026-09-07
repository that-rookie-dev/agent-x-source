import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpDownload } from '../../src/tools/builtin/web.js';
import type { ToolExecutionContext } from '@agentx/shared';

function toStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function mockFetch(overrides?: Partial<Response>): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-length', String(overrides?.body ? 12 : 0)], ['content-type', 'application/octet-stream']]) as unknown as Headers,
    body: toStream('hello world!'),
    ...overrides,
  } as Response));
}

function mockFetchNeverResolves(): typeof fetch {
  return vi.fn(async (_url, init) => {
    return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  });
}

describe('httpDownload', () => {
  let scope: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    scope = mkdtempSync(join(tmpdir(), 'http-download-'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloads a file and returns success metadata', async () => {
    globalThis.fetch = mockFetch();
    const outputs: string[] = [];
    const ctx: ToolExecutionContext = {
      sessionId: 's1',
      scopePath: scope,
      timeout: 30_000,
      onOutput: (o) => outputs.push(o),
    };
    const result = await httpDownload({ url: 'https://example.com/file.txt', output: 'file.txt' }, ctx);
    expect(result.success).toBe(true);
    expect(result.metadata).toBeDefined();
    expect((result.metadata as Record<string, unknown>).download).toMatchObject({
      url: 'https://example.com/file.txt',
      outputPath: 'file.txt',
      size: 12,
      filename: 'file.txt',
    });
    expect(readFileSync(join(scope, 'file.txt'), 'utf-8')).toBe('hello world!');
    expect(outputs.some((o) => o.includes('downloadProgress'))).toBe(true);
  });

  it('derives filename from URL when output is omitted', async () => {
    globalThis.fetch = mockFetch();
    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    const result = await httpDownload({ url: 'https://example.com/folder/data.json' }, ctx);
    expect(result.success).toBe(true);
    expect((result.metadata as Record<string, unknown>).download).toMatchObject({ outputPath: 'data.json', filename: 'data.json' });
    expect(readFileSync(join(scope, 'data.json'), 'utf-8')).toBe('hello world!');
  });

  it('blocks SSRF URLs', async () => {
    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    const result = await httpDownload({ url: 'http://127.0.0.1/secret', output: 'x' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('SSRF_BLOCKED');
  });

  it('returns ABORTED and cleans up the temp file when the abort signal fires', async () => {
    const controller = new AbortController();
    globalThis.fetch = mockFetchNeverResolves();
    const ctx: ToolExecutionContext = {
      sessionId: 's1',
      scopePath: scope,
      timeout: 60_000,
      signal: controller.signal,
    };

    const promise = httpDownload({ url: 'https://example.com/file.bin', output: 'file.bin' }, ctx);
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('ABORTED');
    // No .part file should be left behind.
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(scope, 'file.bin.part'))).toBe(false);
    expect(existsSync(join(scope, 'file.bin'))).toBe(false);
  });

  it('returns ABORTED immediately when the abort signal is already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = mockFetch();
    const ctx: ToolExecutionContext = {
      sessionId: 's1',
      scopePath: scope,
      timeout: 60_000,
      signal: controller.signal,
    };
    const result = await httpDownload({ url: 'https://example.com/file.txt', output: 'file.txt' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('ABORTED');
  });

  it('fails fast with AUTH_REQUIRED on HTTP 401/403', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Map() as unknown as Headers,
      body: null,
    } as Response));
    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    const result = await httpDownload({ url: 'https://example.com/model.bin', output: 'model.bin' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTH_REQUIRED');
    expect(result.output).toContain('authentication required');
  });

  it('rejects binary URLs that return HTML login pages', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-length', '64'], ['content-type', 'text/html']]) as unknown as Headers,
      body: toStream('<html><body>Please log in</body></html>'),
    } as Response));
    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    const result = await httpDownload({ url: 'https://example.com/model.gguf', output: 'model.gguf' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTH_REQUIRED');
    expect(result.output).toContain('text/html');
  });

  it('sends Authorization header when auth parameter is provided', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit | undefined) => ({
      ok: true,
      status: 200,
      headers: new Map([['content-length', '12'], ['content-type', 'application/octet-stream']]) as unknown as Headers,
      body: toStream('hello world!'),
    } as Response));
    globalThis.fetch = fetchMock;
    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    await httpDownload({
      url: 'https://example.com/model.bin',
      output: 'model.bin',
      auth: { type: 'bearer', token: 'secret-token' },
    }, ctx);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer secret-token',
    });
  });

  it('resumes a partial download when a .part file exists and server supports Range', async () => {
    const partial = 'hello ';
    const rest = 'world!';
    const { writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs');
    writeFileSync(join(scope, 'file.txt.part'), partial);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit | undefined) => {
      const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
      expect(range).toBe(`bytes=${partial.length}-`);
      return {
        ok: true,
        status: 206,
        headers: new Map([
          ['content-length', String(rest.length)],
          ['content-type', 'text/plain'],
          ['content-range', `bytes ${partial.length}-${partial.length + rest.length - 1}/${partial.length + rest.length}`],
        ]) as unknown as Headers,
        body: toStream(rest),
      } as Response;
    });
    globalThis.fetch = fetchMock;

    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    const result = await httpDownload({ url: 'https://example.com/file.txt', output: 'file.txt', resume: true }, ctx);
    expect(result.success).toBe(true);
    expect(existsSync(join(scope, 'file.txt'))).toBe(true);
    expect(existsSync(join(scope, 'file.txt.part'))).toBe(false);
    expect(readFileSync(join(scope, 'file.txt'), 'utf-8')).toBe(partial + rest);
  });

  it('follows HTTP 302 redirects to the final binary', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/redirect.bin') {
        return {
          ok: false,
          status: 302,
          headers: new Map([['location', 'https://cdn.example.com/final.bin']]) as unknown as Headers,
          body: null,
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-length', '12'], ['content-type', 'application/octet-stream']]) as unknown as Headers,
        body: toStream('hello world!'),
      } as Response;
    });
    globalThis.fetch = fetchMock;

    const ctx: ToolExecutionContext = { sessionId: 's1', scopePath: scope, timeout: 30_000 };
    const result = await httpDownload({ url: 'https://example.com/redirect.bin', output: 'redirect.bin' }, ctx);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://cdn.example.com/final.bin');
    expect(readFileSync(join(scope, 'redirect.bin'), 'utf-8')).toBe('hello world!');
  });
});
