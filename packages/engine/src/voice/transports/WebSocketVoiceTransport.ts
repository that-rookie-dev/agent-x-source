import type { WebSocket } from 'ws';
import type { VoiceSessionMode } from '@agentx/shared';
import type { VoiceTransport, VoiceTransportAudioChunk, VoiceTransportEvents, VoiceTransportSessionMeta } from './VoiceTransport.js';

export interface WebSocketVoiceTransportOptions {
  ws: WebSocket;
  sessionId: string;
  mode: VoiceSessionMode;
  userId?: string;
  engine?: 'stt_llm_tts' | 'realtime_xai';
  events?: VoiceTransportEvents;
}

export class WebSocketVoiceTransport implements VoiceTransport {
  readonly kind = 'web' as const;
  readonly meta: VoiceTransportSessionMeta;
  private readonly ws: WebSocket;
  private readonly events: VoiceTransportEvents;
  private readonly engine?: 'stt_llm_tts' | 'realtime_xai';
  private closed = false;

  constructor(options: WebSocketVoiceTransportOptions) {
    this.ws = options.ws;
    this.events = options.events ?? {};
    this.engine = options.engine;
    this.meta = {
      sessionId: options.sessionId,
      transport: 'web',
      mode: options.mode,
      userId: options.userId,
    };
  }

  async start(): Promise<void> {
    const payload: Record<string, unknown> = { type: 'session_ready', sessionId: this.meta.sessionId, mode: this.meta.mode };
    if (this.engine) payload.engine = this.engine;
    this.sendControl(payload);
  }

  async sendAudio(chunk: VoiceTransportAudioChunk): Promise<void> {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(chunk.pcm);
  }

  async endTurn(): Promise<void> {
    this.sendControl({ type: 'audio_end', sessionId: this.meta.sessionId });
  }

  async playAudio(pcm: Buffer, sampleRate: number, meta?: { filler?: boolean }): Promise<void> {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.sendControl({
      type: 'audio_chunk_meta',
      sessionId: this.meta.sessionId,
      sampleRate,
      byteLength: pcm.length,
      ...meta,
    });
    this.ws.send(pcm);
  }

  async stopPlayback(): Promise<void> {
    this.sendControl({ type: 'playback_stop', sessionId: this.meta.sessionId });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.sendControl({ type: 'session_end', sessionId: this.meta.sessionId });
    this.events.onClose?.();
  }

  sendControl(payload: Record<string, unknown>): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  handleClientMessage(raw: string | Buffer): void {
    if (typeof raw === 'string') {
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === 'playback_interrupted') {
          this.events.onPlaybackInterrupted?.();
        } else if (msg.type === 'audio_end') {
          this.events.onTurnEnd?.();
        }
      } catch {
        this.events.onError?.(new Error('Invalid voice control frame'));
      }
      return;
    }
    this.events.onAudioInput?.({
      pcm: raw,
      sampleRate: 16_000,
    });
  }
}
