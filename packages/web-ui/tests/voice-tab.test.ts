import { describe, it, expect } from 'vitest';
import { mergeVoiceConfig } from '../src/voice/voice-config';

describe('VoiceTab mergeVoiceConfig', () => {
  it('defaults voice to disabled with web mode off', () => {
    const cfg = mergeVoiceConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.mode?.web).toBe('off');
    expect(cfg.mode?.channels).toBe('off');
  });

  it('merges enable switch and web mode', () => {
    const cfg = mergeVoiceConfig({ enabled: true, mode: { web: 'push-to-talk' } });
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode?.web).toBe('push-to-talk');
    expect(cfg.mode?.channels).toBe('off');
  });

  it('selects styletts2 default voice id when engine is styletts2', () => {
    const cfg = mergeVoiceConfig({ tts: { engine: 'styletts2' } });
    expect(cfg.tts?.engine).toBe('styletts2');
    expect(cfg.tts?.voiceId).toBe('styletts2-default');
  });

  it('keeps kokoro voice id for kokoro engine', () => {
    const cfg = mergeVoiceConfig({ tts: { engine: 'kokoro', voiceId: 'kokoro-bm' } });
    expect(cfg.tts?.voiceId).toBe('kokoro-bm');
  });

  it('preserves downloaded assets list', () => {
    const cfg = mergeVoiceConfig({
      downloadedAssets: [{ assetId: 'kokoro-82m', installedAt: '2026-01-01' }],
    });
    expect(cfg.downloadedAssets).toHaveLength(1);
    expect(cfg.downloadedAssets?.[0]?.assetId).toBe('kokoro-82m');
  });
});

describe('VoiceTab module', () => {
  it('exports VoiceTab component', async () => {
    const mod = await import('../src/components/settings/VoiceTab');
    expect(typeof mod.VoiceTab).toBe('function');
    expect(typeof mod.mergeVoiceConfig).toBe('function');
  });
});
