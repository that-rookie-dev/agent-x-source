import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatResolvedLocationLabel,
  resolveClientLocation,
  type LocationUiState,
  type ResolvedClientLocation,
} from '../utils/resolve-client-location';

export function useLocationPermission(autoRequest = true) {
  const [resolved, setResolved] = useState<ResolvedClientLocation | null>(null);

  const refresh = useCallback(async () => {
    setResolved({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locationMethod: 'timezone_only',
      locationConfidence: 'unknown',
      vpnSuspected: false,
      uiState: 'checking',
      coords: null,
    });
    const next = await resolveClientLocation();
    setResolved(next);
  }, []);

  useEffect(() => {
    if (!autoRequest) return;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [autoRequest, refresh]);

  const state: LocationUiState = resolved?.uiState ?? 'checking';
  const label = useMemo(
    () => (resolved ? formatResolvedLocationLabel(resolved) : 'Requesting permission…'),
    [resolved],
  );

  return {
    state,
    label,
    timezone: resolved?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    coords: resolved?.coords ?? null,
    locationMethod: resolved?.locationMethod,
    vpnSuspected: resolved?.vpnSuspected ?? false,
    resolved: state !== 'checking',
    refresh,
  };
}
