/** Where datetime/location context was collected. */
export type ClientSituationSource = 'browser' | 'desktop' | 'server';

export type ClientLocationMethod = 'gps' | 'ip' | 'timezone_only';

export type ClientLocationConfidence = 'high' | 'low' | 'unknown';

/**
 * Per-turn client context — clock and location from the user's device (browser or desktop).
 * Server-hosted deployments should source this from the web UI, not the host OS.
 */
export interface ClientSituation {
  /** ISO 8601 timestamp from the client clock at send time. */
  clientNow: string;
  /** IANA timezone (e.g. Asia/Kolkata). */
  timezone: string;
  /** Human-readable place label when geocoding or user setting is available. */
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  /** GPS accuracy in meters when available. */
  accuracyMeters?: number;
  source: ClientSituationSource;
  /** How coordinates were obtained — GPS overrides IP; never from server host IP. */
  locationMethod?: ClientLocationMethod;
  locationConfidence?: ClientLocationConfidence;
  /** True when VPN/proxy/hosting detected on IP lookup — do not trust IP coordinates. */
  vpnSuspected?: boolean;
}
