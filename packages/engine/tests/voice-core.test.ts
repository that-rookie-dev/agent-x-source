import { describe, it, expect } from 'vitest';
import { normalizeTextForSpeech } from '../src/voice/speech/normalize.js';
import { mergeVoiceConfig, isVoiceAssetInstalled } from '../src/voice/VoiceAssetCatalog.js';
import { VoiceProgressSession } from '../src/voice/VoiceProgressSession.js';

describe('voice speech normalization', () => {
  it('strips markdown and expands symbols', () => {
    const out = normalizeTextForSpeech('**Hello** `@user` + 50%\n```js\nconsole.log(1)\n```');
    expect(out).toContain('Hello');
    expect(out).not.toContain('```');
    expect(out.toLowerCase()).toContain('percent');
  });

  it('truncates very long responses', () => {
    const out = normalizeTextForSpeech('a'.repeat(5000));
    expect(out.length).toBeLessThan(5000);
    expect(out).toContain('continue');
  });
});

describe('voice config helpers', () => {
  it('merges disabled defaults', () => {
    const cfg = mergeVoiceConfig(undefined);
    expect(cfg.enabled).toBe(false);
    expect(cfg.stt?.modelId).toBe('faster-whisper-base.en');
  });

  it('detects installed assets from config', () => {
    const cfg = mergeVoiceConfig({
      downloadedAssets: [{ assetId: 'kokoro-82m', kind: 'tts-model', installedAt: new Date().toISOString() }],
    });
    expect(isVoiceAssetInstalled(cfg, 'kokoro-82m')).toBe(true);
  });
});

describe('VoiceProgressSession', () => {
  it('throttles repeated filler lines', async () => {
    const spoken: string[] = [];
    const progress = new VoiceProgressSession({
      onSpeak: async (line) => { spoken.push(line); },
      throttleMs: 10_000,
    });
    await progress.speak('Got it.', 'ack');
    await progress.speak('Got it.', 'ack');
    expect(spoken).toEqual(['Got it.']);
  });

  it('skips initial ack when configured', async () => {
    const spoken: string[] = [];
    const progress = new VoiceProgressSession({
      skipInitialAck: true,
      onSpeak: async (line) => { spoken.push(line); },
    });
    await progress.handleEngineEvent({ type: 'loading_start' });
    expect(spoken).toEqual([]);
  });
});

describe('shouldSpeakVoiceAckFiller', () => {
  it('skips greetings and mic checks', async () => {
    const { shouldSpeakVoiceAckFiller } = await import('../src/voice/voiceFillerPolicy.js');
    expect(shouldSpeakVoiceAckFiller('hello there')).toBe(false);
    expect(shouldSpeakVoiceAckFiller('can you hear me')).toBe(false);
    expect(shouldSpeakVoiceAckFiller('thanks')).toBe(false);
  });

  it('allows action-heavy requests', async () => {
    const { shouldSpeakVoiceAckFiller } = await import('../src/voice/voiceFillerPolicy.js');
    expect(shouldSpeakVoiceAckFiller('search the web for black holes')).toBe(true);
    expect(shouldSpeakVoiceAckFiller('please analyze my codebase and find security issues in the auth module')).toBe(true);
  });
});
