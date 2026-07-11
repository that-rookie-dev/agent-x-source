type CacheEntry<T> = { value: T; expiresAt: number };

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedApiCall<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = 30_000,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = fn()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise as Promise<unknown>);
  return promise;
}

export function invalidateApiCache(key?: string): void {
  if (key) {
    cache.delete(key);
    inflight.delete(key);
    return;
  }
  cache.clear();
  inflight.clear();
}

let coreSessionInflight: Promise<string> | null = null;
let coreSessionCached: { id: string; expiresAt: number } | null = null;

/** Deduplicated Agent-X core session id (shared by VoiceProvider + AgentXCoreChat). */
export async function getCoreSessionId(): Promise<string> {
  const now = Date.now();
  if (coreSessionCached && coreSessionCached.expiresAt > now) {
    return coreSessionCached.id;
  }
  if (coreSessionInflight) return coreSessionInflight;

  coreSessionInflight = fetch('/api/agent-x-core/session', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('Failed to open Agent-X session');
      const data = await res.json() as { sessionId?: string };
      if (!data.sessionId) throw new Error('Missing session id');
      coreSessionCached = { id: data.sessionId, expiresAt: Date.now() + 60_000 };
      return data.sessionId;
    })
    .finally(() => {
      coreSessionInflight = null;
    });

  return coreSessionInflight;
}

export function invalidateCoreSessionCache(): void {
  coreSessionCached = null;
  coreSessionInflight = null;
}
