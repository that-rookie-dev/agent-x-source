import { describe, expect, it } from 'vitest';
import { getMicrophoneSetupInstructions } from '../src/utils/microphone-permission';
import { VOICE_MAX_TURN_SECONDS, VOICE_TURN_COUNTDOWN_FROM_SECONDS } from '../src/voice/constants';

describe('microphone setup instructions', () => {
  it('returns recovery steps when denied', () => {
    const steps = getMicrophoneSetupInstructions('denied');
    expect(steps.length).toBeGreaterThan(0);
  });
});

describe('voice constants', () => {
  it('uses 60s max turn with countdown at 45s', () => {
    expect(VOICE_MAX_TURN_SECONDS).toBe(60);
    expect(VOICE_TURN_COUNTDOWN_FROM_SECONDS).toBe(45);
  });
});

describe('wake phrase helpers', () => {
  it('derives wake phrase from persona name', async () => {
    const mod = await import('../src/voice/wake-phrase');
    expect(mod.resolveWakePhrase('JARVIS')).toBe('jarvis');
    expect(mod.resolveWakePhrase('Agent X')).toBe('agent x');
    expect(mod.resolveWakePhrase('')).toBe(mod.WAKE_WORD_FALLBACK);
  });

  it('allows global space in voice modal', async () => {
    const mod = await import('../src/voice/wake-phrase');
    expect(mod.shouldBeginPushToTalkOnSpace({
      globalSpace: true,
      composerFocused: false,
      composerEmpty: true,
      repeat: false,
    })).toBe(true);
    expect(mod.shouldBeginPushToTalkOnSpace({
      globalSpace: false,
      composerFocused: false,
      composerEmpty: true,
      repeat: false,
    })).toBe(false);
  });
});

describe('useVoiceKeyboard module', () => {
  it('exports hook function', async () => {
    const mod = await import('../src/hooks/useVoiceKeyboard');
    expect(typeof mod.useVoiceKeyboard).toBe('function');
  });
});

describe('voice UX components', () => {
  it('exports VoiceDeniedBanner', async () => {
    const mod = await import('../src/components/VoiceDeniedBanner');
    expect(typeof mod.VoiceDeniedBanner).toBe('function');
  });

  it('exports VoiceMicTestPanel', async () => {
    const mod = await import('../src/components/VoiceMicTestPanel');
    expect(typeof mod.VoiceMicTestPanel).toBe('function');
  });

  it('exports VoiceQuickEntry', async () => {
    const mod = await import('../src/components/VoiceQuickEntry');
    expect(typeof mod.VoiceQuickEntry).toBe('function');
  });
});
