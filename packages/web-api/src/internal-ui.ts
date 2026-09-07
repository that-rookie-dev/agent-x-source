import { Readable } from 'node:stream';
import type { UiApiRequest, UiApiResponse, UiRouteInfo } from '@agentx/engine';
import { setUiApiInvoker, setUiRouteLister } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { ApiService } from './services/ApiService.js';
import { router as legacyRouter } from './routes/legacy.js';

const api = new ApiService();
const legacy = legacyRouter({ api });

type ReqLike = {
  method: string;
  url: string;
  originalUrl: string;
  baseUrl: string;
  path: string;
  query: Record<string, string | string[]>;
  params: Record<string, string>;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  get: (h: string) => string | undefined;
  header: (h: string) => string | undefined;
} & Readable;

type ResLike = {
  statusCode: number;
  status: (code: number) => ResLike;
  json: (obj: Record<string, unknown>) => ResLike;
  send: (obj: unknown) => ResLike;
  setHeader: (key: string, value: string | number | string[]) => ResLike;
  writeHead: (code: number, hdrs?: Record<string, string | number | string[]>) => ResLike;
  end: (obj?: unknown) => ResLike;
  write: (_chunk: unknown) => boolean;
  getHeader: (key: string) => unknown;
  set: (key: string, value: string | number | string[]) => ResLike;
  cookie: () => ResLike;
  clearCookie: () => ResLike;
  redirect: () => ResLike;
  location: () => ResLike;
  jsonp: (obj: Record<string, unknown>) => ResLike;
};

type RouterLike = {
  handle: (req: ReqLike, res: ResLike, next: (err?: unknown) => void) => void;
  stack?: unknown[];
};

function parsePath(fullPath: string): { pathname: string; query: Record<string, string | string[]> } {
  const parts = fullPath.split('?', 2);
  const pathname = parts[0] ?? '';
  const search = parts[1];
  const query: Record<string, string | string[]> = {};
  if (search) {
    const params = new URLSearchParams(search);
    for (const [key, value] of params) {
      const existing = query[key];
      if (existing === undefined) {
        query[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        query[key] = [existing, value];
      }
    }
  }
  return { pathname, query };
}

function createRequest(method: string, path: string, body?: Record<string, unknown>): ReqLike {
  const { pathname, query } = parsePath(path);
  const payload = body ? JSON.stringify(body) : '';
  const stream = new Readable({ read() { /* no-op */ } });
  stream.push(payload);
  stream.push(null);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    accept: 'application/json',
  };

  const req = Object.create(stream) as ReqLike;
  req.method = method;
  req.url = path;
  req.originalUrl = path;
  req.baseUrl = '';
  req.path = pathname;
  req.query = query;
  req.params = {};
  req.body = body ?? {};
  req.headers = headers;
  req.get = (header: string) => headers[header.toLowerCase()];
  req.header = (header: string) => req.get(header);
  return req;
}

function createResponse(): { res: ResLike; promise: Promise<UiApiResponse> } {
  let status = 200;
  let hasEnded = false;
  const headers: Record<string, string | number | string[]> = {};
  let body: Record<string, unknown> = {};
  let resolveFn: ((value: UiApiResponse) => void) | null = null;

  const promise = new Promise<UiApiResponse>((resolve) => { resolveFn = resolve; });

  const res: ResLike = {
    statusCode: 200,
    status(code: number) {
      status = code;
      this.statusCode = code;
      return this;
    },
    json(obj: Record<string, unknown>) {
      if (!hasEnded) {
        body = obj ?? {};
        hasEnded = true;
        resolveFn?.({ status, body });
      }
      return this;
    },
    send(obj: unknown) {
      if (!hasEnded) {
        if (typeof obj === 'object' && obj !== null) body = obj as Record<string, unknown>;
        else if (typeof obj === 'string') {
          try { body = JSON.parse(obj) as Record<string, unknown>; } catch { body = { message: obj }; }
        } else { body = {}; }
        hasEnded = true;
        resolveFn?.({ status, body });
      }
      return this;
    },
    setHeader(key: string, value: string | number | string[]) {
      headers[key] = value;
      return this;
    },
    writeHead(code: number, hdrs?: Record<string, string | number | string[]>) {
      status = code;
      this.statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return this;
    },
    end(obj?: unknown) {
      if (!hasEnded) {
        if (obj !== undefined) this.send(obj);
        else {
          hasEnded = true;
          resolveFn?.({ status, body });
        }
      }
      return this;
    },
    write() { return true; },
    getHeader(key: string) { return headers[key]; },
    set(key: string, value: string | number | string[]) { return this.setHeader(key, value); },
    cookie() { return this; },
    clearCookie() { return this; },
    redirect() { return this; },
    location() { return this; },
    jsonp(obj: Record<string, unknown>) { return this.json(obj); },
  };

  return { res, promise };
}

function invokeRoute(router: RouterLike, method: string, path: string, body?: Record<string, unknown>): Promise<UiApiResponse> {
  return new Promise<UiApiResponse>((resolve, reject) => {
    const req = createRequest(method, path, body);
    const { res, promise } = createResponse();

    promise.then(resolve).catch(reject);

    router.handle(req, res, (err: unknown) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } else if (!res.statusCode || res.statusCode === 200) {
        resolve({ status: 404, body: { error: 'not-found', message: `No route matches ${method} ${path}` } });
      }
    });
  });
}

function normalizePath(path: string): string {
  if (!path.startsWith('/api/')) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  return path;
}

async function invokeUiApi(req: UiApiRequest): Promise<UiApiResponse> {
  const path = normalizePath(req.path);
  try {
    const resp = await invokeRoute(legacy as unknown as RouterLike, req.method, path, req.body);
    return resp;
  } catch (e: unknown) {
    getLogger().error('UI_API_INVOKE', e instanceof Error ? e : new Error(String(e)));
    return { status: 500, body: { error: 'invoke-failed', message: e instanceof Error ? e.message : String(e) } };
  }
}

function listUiRoutes(): UiRouteInfo[] {
  const routes: UiRouteInfo[] = [];

  function walkRoute(route: { path?: string; methods?: Record<string, unknown> }) {
    const path = route.path ?? '';
    const methods = Object.keys(route.methods ?? {});
    for (const method of methods) {
      if (method === '_all') continue;
      routes.push({ method: method.toUpperCase(), path });
    }
  }

  function walk(obj: unknown) {
    if (!obj) return;
    const any = obj as Record<string, unknown>;
    if (any.route && typeof any.route === 'object') {
      walkRoute(any.route as { path?: string; methods?: Record<string, unknown> });
      return;
    }
    const routerStack = any.stack ?? (typeof any.handle === 'object' && any.handle ? (any.handle as Record<string, unknown>).stack : undefined);
    if (Array.isArray(routerStack)) {
      for (const sub of routerStack) walk(sub);
    }
  }

  try {
    const top = legacy as unknown as { stack?: unknown[] };
    for (const layer of top.stack ?? []) walk(layer);
  } catch {
    // ignore
  }

  return routes;
}

export function registerInternalUiInvoker(): void {
  setUiApiInvoker(invokeUiApi);
  setUiRouteLister(listUiRoutes);
}
