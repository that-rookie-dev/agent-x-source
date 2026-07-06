import type { VoiceSessionMode, VoiceTransportKind } from '@agentx/shared';

export interface VoiceTransportAudioChunk {
  pcm: Buffer;
  sampleRate: number;
  timestampMs?: number;
}

export interface VoiceTransportEvents {
  onAudioInput?: (chunk: VoiceTransportAudioChunk) => void;
  onTurnEnd?: () => void;
  onPlaybackInterrupted?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export interface VoiceTransportSessionMeta {
  sessionId: string;
  transport: VoiceTransportKind;
  mode: VoiceSessionMode;
  userId?: string;
  channelId?: string;
}

export interface VoiceTransport {
  readonly kind: VoiceTransportKind;
  readonly meta: VoiceTransportSessionMeta;
  start(): Promise<void>;
  sendAudio(chunk: VoiceTransportAudioChunk): Promise<void>;
  endTurn(): Promise<void>;
  playAudio(pcm: Buffer, sampleRate: number): Promise<void>;
  stopPlayback(): Promise<void>;
  close(): Promise<void>;
}
