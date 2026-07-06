import type { ClientSituation, ClientSituationSource } from '../types/client-situation.js';

const VALID_SOURCES = new Set<ClientSituationSource>(['browser', 'desktop', 'server']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parse and validate client situation from API / websocket payloads. */
export function normalizeClientSituation(input: unknown): ClientSituation | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const clientNow = typeof raw.clientNow === 'string' ? raw.clientNow.trim() : '';
  const timezone = typeof raw.timezone === 'string' ? raw.timezone.trim() : '';
  const source = raw.source as ClientSituationSource;
  if (!clientNow || !timezone || !VALID_SOURCES.has(source)) return null;
  if (Number.isNaN(Date.parse(clientNow))) return null;

  const situation: ClientSituation = { clientNow, timezone, source };
  if (typeof raw.locationLabel === 'string' && raw.locationLabel.trim()) {
    situation.locationLabel = raw.locationLabel.trim().slice(0, 256);
  }
  if (isFiniteNumber(raw.latitude) && raw.latitude >= -90 && raw.latitude <= 90) {
    situation.latitude = raw.latitude;
  }
  if (isFiniteNumber(raw.longitude) && raw.longitude >= -180 && raw.longitude <= 180) {
    situation.longitude = raw.longitude;
  }
  if (isFiniteNumber(raw.accuracyMeters) && raw.accuracyMeters >= 0) {
    situation.accuracyMeters = raw.accuracyMeters;
  }
  if (raw.locationMethod === 'gps' || raw.locationMethod === 'ip' || raw.locationMethod === 'timezone_only') {
    situation.locationMethod = raw.locationMethod;
  }
  if (raw.locationConfidence === 'high' || raw.locationConfidence === 'low' || raw.locationConfidence === 'unknown') {
    situation.locationConfidence = raw.locationConfidence;
  }
  if (raw.vpnSuspected === true) {
    situation.vpnSuspected = true;
  }
  return situation;
}

export function resolveClientTimezone(
  situation: ClientSituation | null | undefined,
  fallback: string,
): string {
  return situation?.timezone?.trim() || fallback;
}

export function resolveClientNow(situation: ClientSituation | null | undefined): Date {
  if (situation?.clientNow) {
    const parsed = new Date(situation.clientNow);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function formatLocalTime(now: Date, timezone: string): string {
  try {
    return now.toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone: timezone,
    });
  } catch {
    return now.toISOString();
  }
}

function formatUtcOffset(now: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    const raw = tzPart?.value ?? '';
    const match = raw.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (match) {
      const sign = match[1];
      const hrs = match[2]!.padStart(2, '0');
      const mins = (match[3] ?? '00').padStart(2, '0');
      return `${sign}${hrs}:${mins}`;
    }
  } catch { /* fall through */ }
  return '+00:00';
}

/** Per-turn block injected into the user message so every LLM call sees fresh context. */
export function formatClientSituationBlock(situation: ClientSituation): string {
  const now = resolveClientNow(situation);
  const iso = now.toISOString();
  const local = formatLocalTime(now, situation.timezone);
  const offset = formatUtcOffset(now, situation.timezone);
  const lines = [
    '[CLIENT_SITUATION]',
    `Now (client clock): ${iso}`,
    `User timezone: ${situation.timezone}`,
    `Local time: ${local}`,
    `UTC offset: ${offset}`,
  ];

  if (situation.vpnSuspected) {
    lines.push(`Only the user's timezone (${situation.timezone}) is reliable — their city is unknown (VPN/proxy may be active). Ask where they are before local recommendations.`);
  } else if (situation.locationMethod === 'gps'
    && situation.latitude !== undefined
    && situation.longitude !== undefined) {
    const acc = situation.accuracyMeters !== undefined
      ? ` (±${Math.round(situation.accuracyMeters)}m)`
      : '';
    const place = situation.locationLabel ? ` near ${situation.locationLabel}` : '';
    lines.push(`User is here (device GPS)${place}: ${situation.latitude.toFixed(5)}, ${situation.longitude.toFixed(5)}${acc}.`);
    lines.push('Use for weather, maps, and nearby suggestions unless they name another place.');
  } else if (situation.locationMethod === 'ip'
    && situation.latitude !== undefined
    && situation.longitude !== undefined) {
    const place = situation.locationLabel ?? `${situation.latitude.toFixed(2)}, ${situation.longitude.toFixed(2)}`;
    lines.push(`User is roughly in the ${place} area (city-level estimate, not precise GPS).`);
    lines.push('Fine for broad local context; confirm with the user if exact location matters.');
  } else if (situation.locationLabel) {
    lines.push(`User is roughly in the ${situation.locationLabel} area.`);
  } else {
    lines.push('User\'s place is unknown — ask or search; do not assume a city.');
  }

  lines.push('[/CLIENT_SITUATION]');
  return lines.join('\n');
}
