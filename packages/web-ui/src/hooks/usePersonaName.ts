import { useCallback, useEffect, useState } from 'react';
import { personaApi } from '../api';

const FALLBACK = 'Agent-X';

/**
 * User-configured agent persona name (Settings → Persona).
 * Updates live when persona is saved elsewhere in the app.
 */
export function usePersonaName(fallback = FALLBACK): string {
  const [name, setName] = useState(fallback);

  const load = useCallback(() => {
    void personaApi.get()
      .then((p) => {
        const next = typeof (p as { name?: unknown })?.name === 'string'
          ? String((p as { name: string }).name).trim()
          : '';
        setName(next || fallback);
      })
      .catch(() => {
        setName(fallback);
      });
  }, [fallback]);

  useEffect(() => {
    load();
    const onUpdated = () => load();
    window.addEventListener('agentx:persona-updated', onUpdated);
    return () => window.removeEventListener('agentx:persona-updated', onUpdated);
  }, [load]);

  return name;
}
