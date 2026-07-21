import { isCrewVoiceSessionId } from './crew-voice-session.js';

/** Gap before a same-day time divider is written (hold/resume, long pause). */
export const CALL_DIVIDER_GAP_MS = 15 * 60 * 1000;

export type CallDividerVariant = 'daytime' | 'time' | 'duration';

export interface CallDividerMeta {
  variant: CallDividerVariant;
  label: string;
}

/** Persisted marker row for call-duration (and optional standalone dividers). */
export const CALL_DIVIDER_CONTENT_RE = /^\[call_divider:(daytime|time|duration)\](.*)$/i;

/** Process-local clock of last spoken transcript persist per voice session. */
const lastSpokenAtBySession = new Map<string, number>();

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function formatCallDividerDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatCallDividerDayLabel(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ts));
}

export function formatCallDividerTimeLabel(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));
}

export function formatCallDividerDayTimeLabel(ts: number): string {
  return `${formatCallDividerDayLabel(ts)} · ${formatCallDividerTimeLabel(ts)}`;
}

export function formatCallDividerDurationLabel(ms: number): string {
  return `Call time · ${formatCallDividerDuration(ms)}`;
}

/** Decide which divider (if any) should precede a message at `nextAt`. */
export function decideCallDivider(
  prevAt: number | null | undefined,
  nextAt: number,
  gapMs: number = CALL_DIVIDER_GAP_MS,
): CallDividerMeta | null {
  if (!Number.isFinite(nextAt)) return null;
  if (prevAt == null || !Number.isFinite(prevAt)) {
    return { variant: 'daytime', label: formatCallDividerDayTimeLabel(nextAt) };
  }
  if (dayKey(prevAt) !== dayKey(nextAt)) {
    return { variant: 'daytime', label: formatCallDividerDayTimeLabel(nextAt) };
  }
  if (nextAt - prevAt >= gapMs) {
    return { variant: 'time', label: formatCallDividerTimeLabel(nextAt) };
  }
  return null;
}

export function encodeCallDividerContent(meta: CallDividerMeta): string {
  return `[call_divider:${meta.variant}]${meta.label}`;
}

export function isCallDividerContent(text: string): boolean {
  return CALL_DIVIDER_CONTENT_RE.test(text.trim());
}

export function parseCallDivider(
  content: string | undefined | null,
  metadata?: unknown,
): CallDividerMeta | null {
  const fromMeta = readCallDividerMeta(metadata);
  if (fromMeta) return fromMeta;
  const text = (content ?? '').trim();
  const m = CALL_DIVIDER_CONTENT_RE.exec(text);
  if (!m) return null;
  const variant = m[1]!.toLowerCase() as CallDividerVariant;
  const label = (m[2] ?? '').trim() || fallbackLabel(variant);
  return { variant, label };
}

function fallbackLabel(variant: CallDividerVariant): string {
  if (variant === 'duration') return 'Call time';
  if (variant === 'time') return 'Later';
  return 'Call';
}

export function readCallDividerMeta(metadata: unknown): CallDividerMeta | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as { callDivider?: unknown }).callDivider;
  if (!raw || typeof raw !== 'object') return null;
  const variant = (raw as { variant?: unknown }).variant;
  const label = (raw as { label?: unknown }).label;
  if (variant !== 'daytime' && variant !== 'time' && variant !== 'duration') return null;
  if (typeof label !== 'string' || !label.trim()) return null;
  return { variant, label: label.trim() };
}

/**
 * For voice sessions: advance the spoken-at clock and return a divider to
 * attach on the next persisted spoken message (if any).
 */
export function takeCallDividerForPersist(
  sessionId: string,
  at: number = Date.now(),
): CallDividerMeta | null {
  if (!isCrewVoiceSessionId(sessionId)) return null;
  const prev = lastSpokenAtBySession.has(sessionId)
    ? lastSpokenAtBySession.get(sessionId)!
    : null;
  const divider = decideCallDivider(prev, at);
  lastSpokenAtBySession.set(sessionId, at);
  return divider;
}

/** Seed clock after loading history so reconnects don't rewrite a daytime divider. */
export function seedCallDividerClock(sessionId: string, prevAt: number | null): void {
  if (!isCrewVoiceSessionId(sessionId)) return;
  if (prevAt != null && Number.isFinite(prevAt)) {
    lastSpokenAtBySession.set(sessionId, prevAt);
  } else {
    lastSpokenAtBySession.delete(sessionId);
  }
}

export function resetCallDividerClock(sessionId: string): void {
  lastSpokenAtBySession.delete(sessionId);
}

export function buildDurationDividerMeta(elapsedMs: number): CallDividerMeta {
  return {
    variant: 'duration',
    label: formatCallDividerDurationLabel(elapsedMs),
  };
}
