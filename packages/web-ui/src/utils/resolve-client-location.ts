import type { ClientSituation } from '@agentx/shared';
import { fetchClientIpGeolocation } from './ip-geolocation.js';
import {
  isGeolocationSupported,
  queryGeolocationPermission,
  readClientTimezone,
  requestGeolocationCoords,
  type GeolocationCoords,
} from './location-permission.js';

export type LocationUiState =
  | 'checking'
  | 'granted'
  | 'ip_approx'
  | 'denied'
  | 'vpn_blocked'
  | 'unavailable';

export interface ResolvedClientLocation {
  timezone: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationLabel?: string;
  locationMethod: ClientSituation['locationMethod'];
  locationConfidence: ClientSituation['locationConfidence'];
  vpnSuspected: boolean;
  uiState: LocationUiState;
  coords: GeolocationCoords | null;
}

function readSource(): ClientSituation['source'] {
  const agentx = (window as unknown as { agentx?: { isDesktop?: boolean } }).agentx;
  return agentx?.isDesktop ? 'desktop' : 'browser';
}

export function resolvedLocationToSituation(resolved: ResolvedClientLocation): ClientSituation {
  return {
    clientNow: new Date().toISOString(),
    timezone: resolved.timezone,
    source: readSource(),
    locationMethod: resolved.locationMethod,
    locationConfidence: resolved.locationConfidence,
    vpnSuspected: resolved.vpnSuspected,
    ...(resolved.locationLabel ? { locationLabel: resolved.locationLabel } : {}),
    ...(resolved.latitude !== undefined && resolved.longitude !== undefined
      ? {
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        ...(resolved.accuracyMeters !== undefined ? { accuracyMeters: resolved.accuracyMeters } : {}),
      }
      : {}),
  };
}

export function formatResolvedLocationLabel(resolved: ResolvedClientLocation): string {
  switch (resolved.uiState) {
    case 'checking':
      return 'Requesting permission…';
    case 'granted':
      if (resolved.coords) {
        return `${resolved.coords.latitude.toFixed(2)}, ${resolved.coords.longitude.toFixed(2)} · ${resolved.timezone}`;
      }
      return `Timezone: ${resolved.timezone}`;
    case 'ip_approx':
      return resolved.locationLabel
        ? `${resolved.locationLabel} (approx)`
        : `${resolved.latitude?.toFixed(2)}, ${resolved.longitude?.toFixed(2)} (approx)`;
    case 'vpn_blocked':
      return `VPN/proxy detected · ${resolved.timezone} only`;
    case 'denied':
      return resolved.locationLabel
        ? `${resolved.locationLabel} (approx)`
        : 'Permission denied';
    case 'unavailable':
      return resolved.locationLabel
        ? `${resolved.locationLabel} (approx)`
        : 'Not available in this browser';
    default:
      return resolved.timezone;
  }
}

let cachedSituation: ClientSituation | null = null;

/** Tiered location: GPS → client IP (with VPN guard) → timezone only. Never uses server host IP. */
export async function resolveClientLocation(): Promise<ResolvedClientLocation> {
  const timezone = readClientTimezone();

  if (!isGeolocationSupported()) {
    const ip = await fetchClientIpGeolocation(timezone);
    if (ip && !ip.vpnSuspected) {
      return {
        timezone,
        latitude: ip.latitude,
        longitude: ip.longitude,
        locationLabel: ip.locationLabel,
        locationMethod: 'ip',
        locationConfidence: 'low',
        vpnSuspected: false,
        uiState: 'ip_approx',
        coords: null,
      };
    }
    if (ip?.vpnSuspected) {
      return {
        timezone,
        locationMethod: 'timezone_only',
        locationConfidence: 'unknown',
        vpnSuspected: true,
        uiState: 'vpn_blocked',
        coords: null,
      };
    }
    return {
      timezone,
      locationMethod: 'timezone_only',
      locationConfidence: 'unknown',
      vpnSuspected: false,
      uiState: 'unavailable',
      coords: null,
    };
  }

  const gps = await requestGeolocationCoords();
  if (gps) {
    return {
      timezone,
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracyMeters: gps.accuracyMeters,
      locationMethod: 'gps',
      locationConfidence: 'high',
      vpnSuspected: false,
      uiState: 'granted',
      coords: gps,
    };
  }

  const permission = await queryGeolocationPermission();

  const ip = await fetchClientIpGeolocation(timezone);
  if (ip && !ip.vpnSuspected) {
    return {
      timezone,
      latitude: ip.latitude,
      longitude: ip.longitude,
      locationLabel: ip.locationLabel,
      locationMethod: 'ip',
      locationConfidence: 'low',
      vpnSuspected: false,
      uiState: 'ip_approx',
      coords: null,
    };
  }

  if (ip?.vpnSuspected) {
    return {
      timezone,
      locationMethod: 'timezone_only',
      locationConfidence: 'unknown',
      vpnSuspected: true,
      uiState: 'vpn_blocked',
      coords: null,
    };
  }

  return {
    timezone,
    locationMethod: 'timezone_only',
    locationConfidence: 'low',
    vpnSuspected: false,
    uiState: permission === 'denied' ? 'denied' : 'unavailable',
    coords: null,
  };
}

/** Collect full client situation for agent turns; caches last good GPS/IP result. */
export async function collectClientSituation(): Promise<ClientSituation> {
  const resolved = await resolveClientLocation();
  const situation = resolvedLocationToSituation(resolved);
  if (resolved.locationMethod === 'gps' || resolved.locationMethod === 'ip') {
    cachedSituation = situation;
  }
  if (resolved.locationMethod === 'timezone_only' && cachedSituation?.latitude !== undefined) {
    return {
      ...cachedSituation,
      clientNow: situation.clientNow,
      timezone: situation.timezone,
    };
  }
  return situation;
}
