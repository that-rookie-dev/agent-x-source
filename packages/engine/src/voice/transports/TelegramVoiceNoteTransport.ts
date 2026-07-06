import type { VoiceTransport, VoiceTransportAudioChunk, VoiceTransportSessionMeta } from './VoiceTransport.js';

export interface TelegramVoiceNoteTransportOptions {
  sessionId: string;
  channelId: string;
  userId?: string;
}

/** Batch transport for Telegram voice notes — no streaming playback path. */
export class TelegramVoiceNoteTransport implements VoiceTransport {
  readonly kind = 'telegram' as const;
  readonly meta: VoiceTransportSessionMeta;
  private inputChunks: Buffer[] = [];

  constructor(options: TelegramVoiceNoteTransportOptions) {
    this.meta = {
      sessionId: options.sessionId,
      transport: 'telegram',
      mode: 'voice-notes',
      channelId: options.channelId,
      userId: options.userId,
    };
  }

  async start(): Promise<void> {}

  async sendAudio(chunk: VoiceTransportAudioChunk): Promise<void> {
    this.inputChunks.push(chunk.pcm);
  }

  async endTurn(): Promise<void> {}

  getBufferedAudio(): Buffer {
    return Buffer.concat(this.inputChunks);
  }

  async playAudio(_pcm: Buffer, _sampleRate: number): Promise<void> {
    // Telegram replies are sent as files by the channel plugin, not streamed here.
  }

  async stopPlayback(): Promise<void> {}

  async close(): Promise<void> {
    this.inputChunks = [];
  }
}
