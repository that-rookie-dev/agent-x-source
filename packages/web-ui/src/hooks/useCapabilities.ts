import { useCallback, useEffect, useState } from 'react';
import { capabilities, getAuthToken, type CapabilityRecord } from '../api';
import type { CapabilitySsePayload } from '@agentx/shared';

export function useCapabilities(filter?: { q?: string; status?: string; kind?: string }) {
  const [items, setItems] = useState<CapabilityRecord[]>([]);
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; byKind: Record<string, number> }>({
    total: 0, byStatus: {}, byKind: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await capabilities.list(filter);
      setItems(data.capabilities);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capabilities');
    } finally {
      setLoading(false);
    }
  }, [filter?.q, filter?.status, filter?.kind]);

  useEffect(() => { void reload(); }, [reload]);
  return { items, stats, loading, error, reload, setError };
}

export function useObservations() {
  const [observations, setObservations] = useState<import('../api').ObservedPatternRecord[]>([]);
  const reload = useCallback(async () => {
    const data = await capabilities.observations();
    setObservations(data.observations);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { observations, reload };
}

export function useCapabilitySSE(onEvent: (payload: CapabilitySsePayload) => void) {
  useEffect(() => {
    const token = getAuthToken();
    const url = token
      ? `/api/events/capabilities?token=${encodeURIComponent(token)}`
      : '/api/events/capabilities';
    let es: EventSource | null = null;
    let closed = false;
    let delay = 1000;
    const connect = () => {
      if (closed) return;
      es = new EventSource(url, { withCredentials: true });
      const handler = (ev: MessageEvent) => {
        delay = 1000;
        try {
          onEvent(JSON.parse(ev.data) as CapabilitySsePayload);
        } catch { /* ignore */ }
      };
      [
        'capability:observed',
        'capability:proposed',
        'capability:sandbox-result',
        'capability:graduated',
        'capability:trial-expiring',
        'capability:used',
        'capability:error',
      ].forEach((name) => es?.addEventListener(name, handler));
      es.onerror = () => {
        es?.close();
        delay = Math.min(delay * 2, 30_000);
        setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, [onEvent]);
}
