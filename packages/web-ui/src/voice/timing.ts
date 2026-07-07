export interface VoiceTurnTimings {
  sttMs: number;
  thinkingMs: number;
  ttsMs: number;
  totalMs: number;
  firstAudioMs: number;
}

export function formatVoiceTimingMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function parseVoiceTimings(msg: Record<string, unknown>): VoiceTurnTimings | null {
  const sttMs = Number(msg.sttMs);
  const thinkingMs = Number(msg.thinkingMs);
  const ttsMs = Number(msg.ttsMs);
  const totalMs = Number(msg.totalMs);
  const firstAudioMs = Number(msg.firstAudioMs);
  if (![sttMs, thinkingMs, ttsMs, totalMs, firstAudioMs].every(Number.isFinite)) {
    return null;
  }
  return { sttMs, thinkingMs, ttsMs, totalMs, firstAudioMs };
}
