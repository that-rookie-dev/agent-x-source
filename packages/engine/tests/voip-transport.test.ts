import { describe, it, expect } from 'vitest';
import { VoipVoiceTransport } from '../src/voice/transports/VoipVoiceTransport.js';

describe('VoipVoiceTransport', () => {
  it('fails fast until a telephony adapter is configured', async () => {
    const transport = new VoipVoiceTransport({ sessionId: 'voip-1', callId: '+15551212' });
    await expect(transport.start()).rejects.toThrow(/VOIP voice transport is not configured/);
  });
});
