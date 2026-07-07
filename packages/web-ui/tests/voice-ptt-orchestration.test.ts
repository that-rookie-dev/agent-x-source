import { describe, expect, it } from 'vitest';
import {
  VOICE_ACCIDENTAL_TAP_MS,
  VOICE_MIN_RECORDING_MS,
  VOICE_MIN_SPEECH_LEVEL,
} from '../src/voice/constants';
import { computePushToTalkBlocked } from '../src/voice/voice-ptt-orchestration';

function shouldDiscardCapture(heldMs: number, listenedMs: number, peakAudio: number): boolean {
  const effectiveMs = Math.max(heldMs, listenedMs);
  if (effectiveMs < VOICE_ACCIDENTAL_TAP_MS) return true;
  if (effectiveMs < VOICE_MIN_RECORDING_MS && peakAudio < VOICE_MIN_SPEECH_LEVEL) return true;
  return false;
}

describe('push-to-talk capture', () => {
  it('discards accidental taps', () => {
    expect(shouldDiscardCapture(80, 80, 0)).toBe(true);
  });

  it('accepts short clips with speech energy', () => {
    expect(shouldDiscardCapture(180, 180, 0.12)).toBe(false);
  });

  it('discards short silent holds', () => {
    expect(shouldDiscardCapture(200, 200, 0.01)).toBe(true);
  });
});

describe('computePushToTalkBlocked', () => {
  const base = {
    state: 'ready' as const,
    holding: false,
    pttTurnLocked: true,
    agentTurnComplete: false,
    playbackActive: false,
    playbackLevel: 0,
  };

  it('blocks during locked turn', () => {
    expect(computePushToTalkBlocked(base)).toBe(true);
  });

  it('allows interrupt after turn completes during playback', () => {
    expect(computePushToTalkBlocked({
      ...base,
      state: 'speaking',
      agentTurnComplete: true,
      playbackActive: true,
    })).toBe(false);
  });
});
