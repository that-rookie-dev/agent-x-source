export type LocationPermissionState = 'checking' | 'granted' | 'denied' | 'unavailable';

export interface GeolocationCoords {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

const GEO_TIMEOUT_MS = 12_000;

export function isGeolocationSupported(): boolean {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function readClientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export async function queryGeolocationPermission(): Promise<LocationPermissionState> {
  if (!isGeolocationSupported()) return 'unavailable';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'denied';
    return 'checking';
  } catch {
    return 'checking';
  }
}

export async function requestGeolocationCoords(): Promise<GeolocationCoords | null> {
  if (!isGeolocationSupported()) return null;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), GEO_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: GEO_TIMEOUT_MS },
    );
  });
}

export function formatLocationStatusLabel(
  state: LocationPermissionState,
  timezone: string,
  coords?: GeolocationCoords | null,
): string {
  switch (state) {
    case 'checking':
      return 'Requesting permission…';
    case 'denied':
      return 'Permission denied';
    case 'unavailable':
      return 'Not available in this browser';
    case 'granted':
      if (coords) {
        return `${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)} · ${timezone}`;
      }
      return `Timezone: ${timezone}`;
    default:
      return timezone;
  }
}
