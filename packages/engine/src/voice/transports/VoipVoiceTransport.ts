import type { VoiceTransport, VoiceTransportAudioChunk, VoiceTransportEvents, VoiceTransportSessionMeta } from './VoiceTransport.js';

export interface VoipVoiceTransportOptions {
  sessionId: string;
  callId?: string;
  userId?: string;
  events?: VoiceTransportEvents;
}

/**
 * Placeholder VOIP adapter — documents the contract for future SIP/WebRTC integrations.
 * All methods fail fast until a concrete telephony adapter is registered.
 */
export class VoipVoiceTransport implements VoiceTransport {
  readonly kind = 'voip' as const;
  readonly meta: VoiceTransportSessionMeta;
  private readonly events: VoiceTransportEvents;

  constructor(options: VoipVoiceTransportOptions) {
    this.events = options.events ?? {};
    this.meta = {
      sessionId: options.sessionId,
      transport: 'voip',
      mode: 'duplex',
      userId: options.userId,
      channelId: options.callId,
    };
  }

  async start(): Promise<void> {
    const error = new Error('VOIP voice transport is not configured. Install a telephony adapter to enable phone calls.');
    this.events.onError?.(error);
    throw error;
  }

  async sendAudio(_chunk: VoiceTransportAudioChunk): Promise<void> {
    throw new Error('VOIP transport is not configured');
  }

  async endTurn(): Promise<void> {}

  async playAudio(_pcm: Buffer, _sampleRate: number): Promise<void> {
    throw new Error('VOIP transport is not configured');
  }

  async stopPlayback(): Promise<void> {}

  async close(): Promise<void> {
    this.events.onClose?.();
  }
}
