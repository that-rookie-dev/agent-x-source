/** Client-side IP geolocation — uses the user's public IP, never the Agent-X server host. */

export interface IpGeolocationResult {
  latitude: number;
  longitude: number;
  locationLabel: string;
  ipTimezone?: string;
  vpnSuspected: boolean;
  proxy: boolean;
  hosting: boolean;
}

interface IpWhoResponse {
  success?: boolean;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  timezone?: { id?: string };
  security?: {
    vpn?: boolean;
    proxy?: boolean;
    tor?: boolean;
    hosting?: boolean;
  };
}

const IP_LOOKUP_TIMEOUT_MS = 8_000;
const IP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let ipCache: { result: IpGeolocationResult | null; fetchedAt: number; browserTimezone: string; inflight: Promise<IpGeolocationResult | null> | null } = {
  result: null,
  fetchedAt: 0,
  browserTimezone: '',
  inflight: null,
};

function buildLabel(city?: string, region?: string, country?: string, countryCode?: string): string {
  const parts = [city, region, country || countryCode].filter((p) => p && p.trim());
  return parts.join(', ').slice(0, 256) || 'Unknown';
}

/** Rough timezone mismatch — IP timezone differs from browser Intl timezone. */
export function timezonesLikelyMismatch(browserTz: string, ipTz?: string): boolean {
  if (!ipTz?.trim() || !browserTz.trim()) return false;
  if (browserTz === ipTz) return false;
  try {
    const now = Date.now();
    const browserOffset = new Date(now).toLocaleString('en-US', { timeZone: browserTz, timeZoneName: 'shortOffset' });
    const ipOffset = new Date(now).toLocaleString('en-US', { timeZone: ipTz, timeZoneName: 'shortOffset' });
    return browserOffset !== ipOffset;
  } catch {
    return browserTz !== ipTz;
  }
}

/** Raw IP lookup without caching. */
async function fetchIpWho(browserTimezone: string): Promise<IpGeolocationResult | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), IP_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const data = await res.json() as IpWhoResponse;
    if (!data.success) return null;
    if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return null;

    const proxy = Boolean(data.security?.proxy);
    const hosting = Boolean(data.security?.hosting);
    const vpnFlag = Boolean(data.security?.vpn || data.security?.tor);
    const ipTz = data.timezone?.id;
    const tzMismatch = timezonesLikelyMismatch(browserTimezone, ipTz);
    const vpnSuspected = vpnFlag || proxy || hosting || tzMismatch;

    return {
      latitude: data.latitude,
      longitude: data.longitude,
      locationLabel: buildLabel(data.city, data.region, data.country, data.country_code),
      ipTimezone: ipTz,
      vpnSuspected,
      proxy,
      hosting,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Resolve approximate location from the client's public IP, cached for the session.
 * Returns null on network failure. Sets vpnSuspected when proxy/VPN/hosting flags are set.
 */
export async function fetchClientIpGeolocation(browserTimezone: string): Promise<IpGeolocationResult | null> {
  const now = Date.now();
  if (
    ipCache.result != null
    && ipCache.browserTimezone === browserTimezone
    && now - ipCache.fetchedAt < IP_CACHE_TTL_MS
  ) {
    return ipCache.result;
  }

  if (ipCache.inflight) return ipCache.inflight;

  ipCache.browserTimezone = browserTimezone;
  ipCache.inflight = fetchIpWho(browserTimezone).then((result) => {
    ipCache.result = result;
    ipCache.fetchedAt = Date.now();
    return result;
  }).finally(() => {
    ipCache.inflight = null;
  });

  return ipCache.inflight;
}
