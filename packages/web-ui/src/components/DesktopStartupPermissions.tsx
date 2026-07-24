import { useEffect } from 'react';
import { system } from '../api';

const STORAGE_KEY = 'agentx_startup_permissions_v1';

/**
 * Desktop-only: prime notifications and ensure the global workspace exists
 * (built-in app-data folder — no folder picker).
 */
export function DesktopStartupPermissions() {
  useEffect(() => {
    if (!window.agentx?.isDesktop) return;
    if (sessionStorage.getItem(STORAGE_KEY)) return;

    let cancelled = false;
    void (async () => {
      try {
        await window.agentx?.requestNotifications?.();
      } catch { /* best-effort */ }

      try {
        // Creates built-in workspace under app data if missing.
        await system.workspace();
      } catch { /* ignore */ }

      if (!cancelled) sessionStorage.setItem(STORAGE_KEY, '1');
    })();

    return () => { cancelled = true; };
  }, []);

  return null;
}
