/**
 * Browser persistence scoped to Agent-X (localStorage + sessionStorage).
 * Keys use the `agentx_` prefix so a fresh install can wipe all client state at once.
 */

export const AGENTX_CLIENT_STORAGE_PREFIX = 'agentx_';
export const AGENTX_AUTH_TOKEN_KEY = 'agentx_auth_token';

function collectPrefixedKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(AGENTX_CLIENT_STORAGE_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function removePrefixedKeys(storage: Storage): string[] {
  const removed: string[] = [];
  for (const key of collectPrefixedKeys(storage)) {
    try {
      storage.removeItem(key);
      removed.push(key);
    } catch {
      /* private mode / quota */
    }
  }
  return removed;
}

/** Remove every Agent-X key from localStorage and sessionStorage. */
export function clearAgentxClientStorage(): string[] {
  return [
    ...removePrefixedKeys(localStorage),
    ...removePrefixedKeys(sessionStorage),
  ];
}
