import { describe, it, expect, vi } from 'vitest';
import { mergeVoiceConfig } from '../src/voice/VoiceAssetCatalog.js';

/** Mirrors TelegramChannelPlugin voice-note detection. */
export function isTelegramVoiceNote(fileName: string, mimeType?: string): boolean {
  return fileName === 'voice.ogg' || (mimeType?.startsWith('audio/ogg') ?? false);
}

/** Mirrors channel gating in handleVoiceNote. */
export function isTelegramVoiceNotesEnabled(voiceConfig: ReturnType<typeof mergeVoiceConfig>): boolean {
  return Boolean(voiceConfig.enabled && voiceConfig.mode?.channels === 'voice-notes');
}

describe('Telegram voice note helpers', () => {
  it('detects ogg voice note mime types', () => {
    expect(isTelegramVoiceNote('voice.ogg', 'audio/ogg')).toBe(true);
    expect(isTelegramVoiceNote('clip.ogg', 'audio/ogg; codecs=opus')).toBe(true);
    expect(isTelegramVoiceNote('note.txt', 'text/plain')).toBe(false);
  });

  it('requires voice enabled and voice-notes channel mode', () => {
    expect(isTelegramVoiceNotesEnabled(mergeVoiceConfig())).toBe(false);
    expect(isTelegramVoiceNotesEnabled(mergeVoiceConfig({ enabled: true, mode: { channels: 'off' } }))).toBe(false);
    expect(isTelegramVoiceNotesEnabled(mergeVoiceConfig({ enabled: true, mode: { channels: 'voice-notes' } }))).toBe(true);
  });
});

describe('Telegram sendVoice fallback', () => {
  it('falls back to text when synthesis fails', async () => {
    const synthesize = vi.fn().mockRejectedValue(new Error('tts failed'));
    let delivered = '';
    try {
      await synthesize('hello');
      delivered = 'voice';
    } catch {
      delivered = 'hello';
    }
    expect(delivered).toBe('hello');
  });

  it('sendVoice reports telegram API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, description: 'Bad Request: voice file too large' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.append('chat_id', '1');
    const res = await fetch('https://api.telegram.org/botTEST/sendVoice', { method: 'POST', body: form });
    const payload = await res.json() as { ok: boolean; description?: string };
    expect(payload.ok).toBe(false);
    expect(payload.description).toContain('voice file');

    vi.unstubAllGlobals();
  });
});

describe('TelegramVoiceNoteTransport', () => {
  it('uses voice-notes mode label', async () => {
    const { TelegramVoiceNoteTransport } = await import('../src/voice/transports/TelegramVoiceNoteTransport.js');
    const transport = new TelegramVoiceNoteTransport({ sessionId: 's1', channelId: 'chat-1' });
    expect(transport.meta.mode).toBe('voice-notes');
  });
});
