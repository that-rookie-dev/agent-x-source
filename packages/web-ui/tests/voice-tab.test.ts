import { describe, it, expect } from 'vitest';
import { mergeVoiceConfig, applyVoicePreset } from '../src/voice/voice-config';

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

  it('keeps kokoro voice id for kokoro engine', () => {
    const cfg = mergeVoiceConfig({ tts: { engine: 'kokoro', voiceId: 'kokoro-bm' } });
    expect(cfg.tts?.voiceId).toBe('kokoro-bm');
  });

  it('preserves downloaded assets list', () => {
    const cfg = mergeVoiceConfig({
      downloadedAssets: [{ assetId: 'kokoro-onnx', installedAt: '2026-01-01' }],
    });
    expect(cfg.downloadedAssets).toHaveLength(1);
    expect(cfg.downloadedAssets?.[0]?.assetId).toBe('kokoro-onnx');
  });

  it('upgrades legacy config: enabled=true with mode.web=off → push-to-talk', () => {
    const cfg = mergeVoiceConfig({ enabled: true, mode: { web: 'off' } });
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode?.web).toBe('push-to-talk');
  });

  it('upgrades legacy config: enabled=true with no mode → push-to-talk', () => {
    const cfg = mergeVoiceConfig({ enabled: true });
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode?.web).toBe('push-to-talk');
  });

  it('keeps disabled voice with mode.web=off', () => {
    const cfg = mergeVoiceConfig({ enabled: false, mode: { web: 'off' } });
    expect(cfg.enabled).toBe(false);
    expect(cfg.mode?.web).toBe('off');
  });
});

describe('applyVoicePreset', () => {
  it('enables voice with push-to-talk web mode', () => {
    const cfg = applyVoicePreset(mergeVoiceConfig());
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode?.web).toBe('push-to-talk');
  });

  it('forces local duplex leftovers back to push-to-talk', () => {
    const cfg = applyVoicePreset(mergeVoiceConfig({ engine: 'stt_llm_tts', mode: { web: 'duplex' } }));
    expect(cfg.mode?.web).toBe('push-to-talk');
  });

  it('keeps xAI on duplex', () => {
    const cfg = applyVoicePreset(mergeVoiceConfig({ engine: 'realtime_xai', mode: { web: 'push-to-talk' } }));
    expect(cfg.mode?.web).toBe('duplex');
  });
});

describe('mergeVoiceConfig local duplex coerce', () => {
  it('coerces stale local duplex to push-to-talk', () => {
    const cfg = mergeVoiceConfig({
      enabled: true,
      engine: 'stt_llm_tts',
      mode: { web: 'duplex' },
    });
    expect(cfg.mode?.web).toBe('push-to-talk');
  });
});

describe('VoiceTab module', () => {
  it('exports VoiceTab component', async () => {
    const mod = await import('../src/components/settings/VoiceTab');
    expect(typeof mod.VoiceTab).toBe('function');
    expect(typeof mod.mergeVoiceConfig).toBe('function');
  });
});
