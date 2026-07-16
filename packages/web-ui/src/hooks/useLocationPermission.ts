import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatResolvedLocationLabel,
  resolveClientLocation,
  resolvedLocationToSituation,
  type LocationUiState,
  type ResolvedClientLocation,
} from '../utils/resolve-client-location';

const LOCATION_CACHE_KEY = 'agentx_location_resolved_v1';
const LOCATION_CACHE_TTL_MS = 30 * 60 * 1000;

let memoryLocationCache: ResolvedClientLocation | null = null;

function isCacheFresh(cached: ResolvedClientLocation): boolean {
  if (!cached.resolvedAt) return true;
  return Date.now() - cached.resolvedAt < LOCATION_CACHE_TTL_MS;
}

function locationClass(uiState: LocationUiState): number {
  switch (uiState) {
    case 'granted': return 2;
    case 'ip_approx': return 1;
    default: return 0;
  }
}

function shouldReplaceCache(prev: ResolvedClientLocation | null, next: ResolvedClientLocation): boolean {
  if (!prev) return true;
  return locationClass(next.uiState) >= locationClass(prev.uiState);
}

function loadLocationCache(): ResolvedClientLocation | null {
  if (memoryLocationCache) {
    if (isCacheFresh(memoryLocationCache)) return memoryLocationCache;
    memoryLocationCache = null;
  }
  try {
    const raw = sessionStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResolvedClientLocation;
    if (parsed?.uiState && parsed.uiState !== 'checking' && isCacheFresh(parsed)) {
      memoryLocationCache = parsed;
      return parsed;
    }
  } catch { /* ignore corrupt cache */ }
  return null;
}

function saveLocationCache(location: ResolvedClientLocation): ResolvedClientLocation {
  if (location.uiState === 'checking') return location;
  const withTimestamp = { ...location, resolvedAt: Date.now() };
  const existing = loadLocationCache();
  if (!shouldReplaceCache(existing, withTimestamp)) {
    return existing ?? withTimestamp;
  }
  memoryLocationCache = withTimestamp;
  try {
    sessionStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(withTimestamp));
  } catch { /* ignore quota errors */ }
  return withTimestamp;
}

export function useLocationPermission(autoRequest = true) {
  const [resolved, setResolved] = useState<ResolvedClientLocation | null>(() => loadLocationCache());
  const refreshingRef = useRef(false);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
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
      const saved = saveLocationCache(next);
      setResolved(saved);
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!autoRequest) return;
    const cached = loadLocationCache();
    if (cached) {
      setResolved(cached);
      // Only re-resolve on mount if the cached value is stale or imprecise.
      if (!isCacheFresh(cached) || locationClass(cached.uiState) < 2) {
        void refresh({ silent: true });
      }
    } else {
      void refresh();
    }
    const onFocus = () => {
      const current = loadLocationCache();
      if (!current || !isCacheFresh(current) || locationClass(current.uiState) < 2) {
        void refresh({ silent: true });
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [autoRequest, refresh]);

  const state: LocationUiState = resolved?.uiState ?? 'checking';
  const label = useMemo(
    () => (resolved ? formatResolvedLocationLabel(resolved) : 'Requesting permission…'),
    [resolved],
  );
  const clientSituation = useMemo(
    () => (resolved ? resolvedLocationToSituation(resolved) : null),
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
    clientSituation,
    refresh,
  };
}
