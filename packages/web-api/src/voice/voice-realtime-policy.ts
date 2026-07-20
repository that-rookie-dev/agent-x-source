/** Idle gap under which xAI conversation cache is treated as still live (safety margin vs ~30m). */
export const XAI_RESUME_IDLE_MS = 25 * 60 * 1000;
/** Idle gap after which we inject summary only (no recent-turn reminder). */
export const VOICE_SUMMARY_ONLY_IDLE_MS = 120 * 60 * 1000;
/** At most one summary rebuild per session per day. */
export const SUMMARY_REBUILD_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Cap recent turns injected in the 25–120m remind band. */
export const REMIND_RECENT_MAX_MESSAGES = 8;

export type VoiceIdleBand = 'hot' | 'warm' | 'cold' | 'fresh';

export function resolveVoiceIdleBand(idleMs: number | null | undefined): VoiceIdleBand {
  if (idleMs == null || !Number.isFinite(idleMs) || idleMs < 0) return 'fresh';
  if (idleMs < XAI_RESUME_IDLE_MS) return 'hot';
  if (idleMs < VOICE_SUMMARY_ONLY_IDLE_MS) return 'warm';
  return 'cold';
}

export function idleMsSince(lastVoiceActiveAt: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!lastVoiceActiveAt) return null;
  const t = Date.parse(lastVoiceActiveAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, nowMs - t);
}

export function summaryNeedsDailyRebuild(
  summaryUpdatedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!summaryUpdatedAt) return true;
  const t = Date.parse(summaryUpdatedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= SUMMARY_REBUILD_MIN_INTERVAL_MS;
}
