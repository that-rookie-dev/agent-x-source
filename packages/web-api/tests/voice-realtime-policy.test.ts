import { describe, expect, it } from 'vitest';
import {
  XAI_RESUME_IDLE_MS,
  VOICE_SUMMARY_ONLY_IDLE_MS,
  SUMMARY_REBUILD_MIN_INTERVAL_MS,
  idleMsSince,
  resolveVoiceIdleBand,
  summaryNeedsDailyRebuild,
} from '../src/voice/voice-realtime-policy.js';

describe('voice-realtime-policy', () => {
  it('treats missing activity as fresh', () => {
    expect(resolveVoiceIdleBand(null)).toBe('fresh');
    expect(resolveVoiceIdleBand(undefined)).toBe('fresh');
    expect(idleMsSince(null)).toBeNull();
  });

  it('uses 25m hot / 120m warm / colder cold bands', () => {
    expect(resolveVoiceIdleBand(0)).toBe('hot');
    expect(resolveVoiceIdleBand(XAI_RESUME_IDLE_MS - 1)).toBe('hot');
    expect(resolveVoiceIdleBand(XAI_RESUME_IDLE_MS)).toBe('warm');
    expect(resolveVoiceIdleBand(VOICE_SUMMARY_ONLY_IDLE_MS - 1)).toBe('warm');
    expect(resolveVoiceIdleBand(VOICE_SUMMARY_ONLY_IDLE_MS)).toBe('cold');
    expect(resolveVoiceIdleBand(VOICE_SUMMARY_ONLY_IDLE_MS * 3)).toBe('cold');
  });

  it('computes idle from last_voice_active_at', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    const active = '2026-07-20T11:40:00.000Z'; // 20m idle
    expect(idleMsSince(active, now)).toBe(20 * 60 * 1000);
    expect(resolveVoiceIdleBand(idleMsSince(active, now))).toBe('hot');
  });

  it('requires a day before summary rebuild', () => {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    expect(summaryNeedsDailyRebuild(null, now)).toBe(true);
    expect(summaryNeedsDailyRebuild('2026-07-20T10:00:00.000Z', now)).toBe(false);
    expect(summaryNeedsDailyRebuild(
      new Date(now - SUMMARY_REBUILD_MIN_INTERVAL_MS).toISOString(),
      now,
    )).toBe(true);
  });
});
