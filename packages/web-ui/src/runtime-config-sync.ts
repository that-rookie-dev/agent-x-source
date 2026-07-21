/** Cross-panel sync when provider/model selection changes in Settings while Chat stays mounted. */

export const RUNTIME_CONFIG_CHANGED_EVENT = 'agentx:runtime-config-changed';

export function emitRuntimeConfigChanged(detail?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RUNTIME_CONFIG_CHANGED_EVENT, { detail }));
}

export function onRuntimeConfigChanged(handler: (detail?: Record<string, unknown>) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = event instanceof CustomEvent
      ? (event.detail as Record<string, unknown> | undefined)
      : undefined;
    handler(detail);
  };
  window.addEventListener(RUNTIME_CONFIG_CHANGED_EVENT, listener);
  return () => window.removeEventListener(RUNTIME_CONFIG_CHANGED_EVENT, listener);
}
