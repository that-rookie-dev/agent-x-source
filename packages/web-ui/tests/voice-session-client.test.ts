import { describe, it, expect } from 'vitest';
import { VOICE_WS_PATH } from '../src/voice/VoiceSessionClient.js';

describe('VoiceSessionClient protocol', () => {
  it('uses authenticated voice websocket path', () => {
    expect(VOICE_WS_PATH).toBe('/ws/voice');
  });
});
