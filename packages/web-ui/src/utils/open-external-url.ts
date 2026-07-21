/**
 * Open http(s) links in the desktop shell / OS browser.
 * In the browser build, falls back to a new tab.
 */

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

export function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    return EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/** Open an absolute or relative http(s) URL outside the app. */
export function openExternalUrl(url: string): void {
  if (!url) return;
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return;
    // Stay inside the app for same-origin routes.
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return;

    const bridge = typeof window !== 'undefined' ? window.agentx : undefined;
    if (bridge?.openExternal) {
      void bridge.openExternal(parsed.href);
      return;
    }
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  } catch {
    /* ignore malformed */
  }
}

/**
 * Capture-phase handler for chat/markdown containers.
 * Returns true when the click was handled as an external link.
 */
export function handleExternalAnchorClick(event: { target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }): boolean {
  const el = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(el instanceof HTMLAnchorElement)) return false;
  const href = el.href || el.getAttribute('href') || '';
  if (!isExternalHttpUrl(href)) return false;
  try {
    const parsed = new URL(href);
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return false;
  } catch {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  openExternalUrl(href);
  return true;
}
