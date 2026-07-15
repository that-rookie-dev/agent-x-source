import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

type RequestInfo = string | URL | Request;
interface RequestInitWithAgent extends RequestInit {
  agent?: http.Agent | https.Agent;
}

let httpAgent: http.Agent | undefined;
let httpsAgent: https.Agent | undefined;
let fetchConfigured = false;
let originalFetch: typeof fetch | undefined;

function getHttpAgentInternal(): http.Agent {
  if (!httpAgent) {
    httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 60_000,
      keepAliveMsecs: 30_000,
    });
  }
  return httpAgent;
}

function getHttpsAgentInternal(): https.Agent {
  if (!httpsAgent) {
    httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 60_000,
      keepAliveMsecs: 30_000,
    });
  }
  return httpsAgent;
}

/** Returns a shared keep-alive HTTP agent. */
export function getHttpAgent(): http.Agent {
  return getHttpAgentInternal();
}

/** Returns a shared keep-alive HTTPS agent. */
export function getHttpsAgent(): https.Agent {
  return getHttpsAgentInternal();
}

function normalizeHeaders(headers?: RequestInit['headers']): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  if (!headers) return out;

  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      out[key] = value;
    }
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      out[key] = value;
    }
  }
  return out;
}

function toRequestBody(body: RequestInit['body']): string | Buffer | Readable | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Readable) return body;
  if (body instanceof ReadableStream) return Readable.fromWeb(body as unknown as import('node:stream/web').ReadableStream);
  // Best-effort for other body types (FormData, URLSearchParams, etc.) — not used by provider clients.
  return Buffer.from(String(body));
}

function createResponse(
  res: http.IncomingMessage,
  status: number,
  statusText: string,
  bodyStream: Readable,
): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined || key === 'content-encoding' || key === 'content-length' || key === 'transfer-encoding') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const webBody = Readable.toWeb(bodyStream);
  // Node's stream/web ReadableStream is structurally compatible with the DOM ReadableStream
  // that Response expects, but TypeScript tracks them as distinct types.
  return new Response(webBody as unknown as ReadableStream<Uint8Array>, { status, statusText, headers });
}

async function fetchWithKeepAlive(input: RequestInfo | URL, init?: RequestInitWithAgent): Promise<Response> {
  let urlStr: string;
  let method = init?.method ?? 'GET';
  let headers = init ? normalizeHeaders(init.headers) : {};
  const rawBody = init?.body instanceof Blob ? Buffer.from(await init.body.arrayBuffer()) : init?.body;
  let body = init ? toRequestBody(rawBody) : undefined;

  if (input instanceof URL) {
    urlStr = input.href;
  } else if (typeof input === 'string') {
    urlStr = input;
  } else if (input instanceof Request) {
    urlStr = input.url;
    method = input.method;
    headers = normalizeHeaders(input.headers);
    body = toRequestBody(input.body);
  } else {
    throw new TypeError('Unsupported input type for fetch');
  }

  const url = new URL(urlStr);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    if (!originalFetch) throw new TypeError(`Unsupported protocol: ${url.protocol}`);
    return originalFetch(input, init);
  }

  const isHttps = url.protocol === 'https:';
  const requestModule = isHttps ? https : http;
  const userAgent = init?.agent;
  const agent =
    userAgent && ((isHttps && userAgent instanceof https.Agent) || (!isHttps && userAgent instanceof http.Agent))
      ? userAgent
      : undefined;

  const requestOptions: http.RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isHttps ? '443' : '80'),
    path: url.pathname + url.search,
    method,
    headers,
    agent,
    signal: init?.signal ?? undefined,
  };

  return new Promise((resolve, reject) => {
    const req = requestModule.request(requestOptions, (res) => {
      if (res.aborted) return;

      let statusCode = res.statusCode ?? 200;
      if (statusCode < 200 || statusCode >= 600) {
        statusCode = Math.min(599, Math.max(200, statusCode));
      }
      const statusText = res.statusMessage ?? '';

      const shouldHaveBody = method !== 'HEAD' && statusCode !== 204 && statusCode !== 304;
      if (!shouldHaveBody) {
        res.resume();
        resolve(new Response(null, { status: statusCode, statusText, headers: new Headers() }));
        return;
      }

      const encoding = res.headers['content-encoding'];
      let stream: Readable = res;
      if (encoding) {
        const lower = Array.isArray(encoding) ? encoding[0] : encoding;
        if (lower === 'gzip') {
          stream = res.pipe(createGunzip());
        } else if (lower === 'deflate') {
          stream = res.pipe(createInflate());
        } else if (lower === 'br') {
          stream = res.pipe(createBrotliDecompress());
        }
        stream.on('error', (err) => {
          res.destroy();
          reject(err);
        });
      }

      resolve(createResponse(res, statusCode, statusText, stream));
    });

    req.on('error', reject);

    const bodyStream = typeof body === 'string' || Buffer.isBuffer(body) ? undefined : body;
    const bodyData = typeof body === 'string' ? Buffer.from(body) : Buffer.isBuffer(body) ? body : undefined;

    if (bodyStream) {
      bodyStream.pipe(req);
    } else if (bodyData) {
      req.end(bodyData);
    } else {
      req.end();
    }
  });
}

/**
 * Configure the process to use keep-alive HTTP/HTTPS agents and patch
 * global fetch so provider clients reuse connections.
 */
export function configureHttpKeepAlive(): void {
  if (fetchConfigured) return;
  fetchConfigured = true;

  http.globalAgent = getHttpAgentInternal();
  https.globalAgent = getHttpsAgentInternal();

  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithKeepAlive(input, init as RequestInitWithAgent)) as typeof fetch;
}
