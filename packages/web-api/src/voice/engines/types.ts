import type { WebSocket } from 'ws';
import type { VoiceSessionMode, ClientSituation } from '@agentx/shared';
import type { WebSocketVoiceTransport } from '@agentx/engine';

export type VoiceEngineType = 'stt_llm_tts' | 'realtime_xai';

export type VoiceEngineState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export interface VoiceEngineSession {
  sessionId: string;
  chatSessionId?: string;
  mode: VoiceSessionMode;
  getState(): VoiceEngineState;
  onBinaryAudio(_pcm: Buffer): void;
  onClientMessage(_msg: Record<string, unknown>): Promise<void>;
  onDisconnect(): void;
}

export interface VoiceEngineSessionOptions {
  ws: WebSocket;
  transport: WebSocketVoiceTransport;
  sessionId: string;
  mode: VoiceSessionMode;
  chatSessionId?: string;
  clientSituation?: ClientSituation | null;
}

export interface VoiceEngine {
  readonly type: VoiceEngineType;
  start(): Promise<void>;
  createSession(_options: VoiceEngineSessionOptions): Promise<VoiceEngineSession>;
  closeSession(_session: VoiceEngineSession): Promise<void>;
}
