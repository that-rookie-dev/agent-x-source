/** Optional hook registered by web-api to align channel agent with the active UI session. */
let syncHook: (() => void) | null = null;

export function setChannelSuperSessionSync(fn: (() => void) | null): void {
  syncHook = fn;
}

export function syncChannelSuperSessionContext(): void {
  try {
    syncHook?.();
  } catch { /* best-effort */ }
}
