const BASE = '';

const ERROR_MESSAGES: Record<string, string> = {
  'provider-unreachable': 'Provider unreachable — check your credentials or network',
  'could-not-reach-lmstudio': 'LM Studio not reachable at the specified address',
  'save-failed': 'Failed to save changes',
  'profile-add-failed': 'Failed to create profile',
  'switch-failed': 'Failed to switch',
  'trial-failed': 'Model trial failed',
  'failed-to-list-models': 'Failed to list models',
  'ui-proxy-failed': 'Failed to load UI proxy',
  'no-session': 'No active session — create or restore a session first',
  'not-found': 'Not found',
  'text-required': 'Message is required',
  'chat-failed': 'Failed to send chat message',
  'clear-failed': 'Operation failed',
  'delete-failed': 'Delete failed',
  'create-failed': 'Create failed',
  'respond-failed': 'Permission response failed',
};

function makeError(status: number, bodyOrText: unknown) {
  let code: string | undefined;
  let userMessage: string | undefined;
  if (bodyOrText && typeof bodyOrText === 'object') {
    const b: any = bodyOrText;
    code = b.error || b.code || b.err;
    userMessage = b.message || b.error || b.msg || undefined;
  } else if (typeof bodyOrText === 'string') {
    userMessage = bodyOrText;
  }
  if (!userMessage && code && ERROR_MESSAGES[code]) userMessage = ERROR_MESSAGES[code];
  if (!userMessage) userMessage = `Request failed (${status})`;
  const err = new Error(userMessage);
  (err as any).status = status;
  if (code) (err as any).code = code;
  (err as any).raw = bodyOrText;
  return err;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try {
        const body = await res.json();
        throw makeError(res.status, body);
      } catch (e) {
        // fall back to text
        const text = await res.text().catch(() => '');
        throw makeError(res.status, text || `${res.status} ${res.statusText}`);
      }
    }
    const text = await res.text().catch(() => '');
    throw makeError(res.status, text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function handleNonOk(res: Response, method: string, path: string) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      const body = await res.json();
      throw makeError(res.status, body);
    } catch {
      const text = await res.text().catch(() => '');
      throw makeError(res.status, text || `${res.status} ${res.statusText}`);
    }
  }
  const text = await res.text().catch(() => '');
  throw makeError(res.status, text || `${res.status} ${res.statusText}`);
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) await handleNonOk(res, 'POST', path);
  return res.json().catch(() => ({}) as T);
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await handleNonOk(res, 'PUT', path);
  return res.json().catch(() => ({}) as T);
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) await handleNonOk(res, 'DELETE', path);
  return res.json().catch(() => ({}) as T);
}

type WsHandler = (event: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
const handlers = new Set<WsHandler>();

export function connectWs(): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    // connected
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      handlers.forEach((h) => h(data));
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    ws = null;
    // reconnect after 3s
    setTimeout(connectWs, 3000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function sendWs(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function onWsEvent(handler: WsHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
