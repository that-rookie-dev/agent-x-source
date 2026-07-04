import { useEffect } from 'react';
import { system } from '../api';
import { resolveDefaultWorkspace } from '../utils/default-workspace';

const STORAGE_KEY = 'agentx_startup_permissions_v1';

/**
 * Desktop-only: prime notifications and set Desktop as workspace on first launch
 * without showing a folder picker.
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
        const { cwd } = await system.cwd();
        if (!cancelled && !cwd) {
          const desktop = await resolveDefaultWorkspace();
          await system.setCwd(desktop);
        }
      } catch { /* ignore */ }

      if (!cancelled) sessionStorage.setItem(STORAGE_KEY, '1');
    })();

    return () => { cancelled = true; };
  }, []);

  return null;
}
