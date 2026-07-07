import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatResolvedLocationLabel,
  resolveClientLocation,
  type LocationUiState,
  type ResolvedClientLocation,
} from '../utils/resolve-client-location';

const LOCATION_CACHE_KEY = 'agentx_location_resolved_v1';

let memoryLocationCache: ResolvedClientLocation | null = null;

function loadLocationCache(): ResolvedClientLocation | null {
  if (memoryLocationCache) return memoryLocationCache;
  try {
    const raw = sessionStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResolvedClientLocation;
    if (parsed?.uiState && parsed.uiState !== 'checking') {
      memoryLocationCache = parsed;
      return parsed;
    }
  } catch { /* ignore corrupt cache */ }
  return null;
}

function saveLocationCache(location: ResolvedClientLocation): void {
  if (location.uiState === 'checking') return;
  memoryLocationCache = location;
  try {
    sessionStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(location));
  } catch { /* ignore quota errors */ }
}

export function useLocationPermission(autoRequest = true) {
  const [resolved, setResolved] = useState<ResolvedClientLocation | null>(() => loadLocationCache());

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent && !loadLocationCache()) {
      setResolved({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locationMethod: 'timezone_only',
        locationConfidence: 'unknown',
        vpnSuspected: false,
        uiState: 'checking',
        coords: null,
      });
    }
    const next = await resolveClientLocation();
    saveLocationCache(next);
    setResolved(next);
  }, []);

  useEffect(() => {
    if (!autoRequest) return;
    const cached = loadLocationCache();
    if (cached) {
      setResolved(cached);
      void refresh({ silent: true });
    } else {
      void refresh();
    }
    const onFocus = () => { void refresh({ silent: true }); };
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
