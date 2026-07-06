import { syncAuthTokenFromSession } from '../api';
import { VOICE_SAMPLE_RATE } from './pcm.js';
import { StreamingPlayback } from './playback.js';
import { VOICE_CAPTURE_PROCESSOR_NAME, VOICE_CAPTURE_PROCESSOR_URL } from './audioWorkletProcessor.js';
import { isVoiceOutputUnlocked, markVoiceOutputUnlocked } from './support.js';

export const VOICE_WS_PATH = '/ws/voice';
export { VOICE_SAMPLE_RATE };

const VOICE_CONNECT_TIMEOUT_MS = 120_000;

export type VoiceClientState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export interface VoiceSessionClientEvents {
  onStateChange?: (state: VoiceClientState) => void;
  onTranscriptPartial?: (text: string) => void;
  onTranscriptFinal?: (text: string, empty?: boolean) => void;
  onAgentText?: (text: string) => void;
  onError?: (message: string) => void;
  onAgentStatus?: (status: string) => void;
  onAudioLevel?: (level: number) => void;
  onPlaybackLevel?: (level: number) => void;
  onDuplexSilence?: (elapsedMs: number, thresholdMs: number) => void;
}

export interface VoiceSessionClientOptions extends VoiceSessionClientEvents {
  mode?: 'push-to-talk' | 'duplex';
  authToken?: string | null;
  chatSessionId?: string;
}

function wsUrl(authToken?: string | null): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  return `${proto}://${window.location.host}${VOICE_WS_PATH}${tokenQuery}`;
}

export class VoiceSessionClient {
  private ws: WebSocket | null = null;
  private state: VoiceClientState = 'idle';
  private readonly events: VoiceSessionClientEvents;
  private readonly mode: 'push-to-talk' | 'duplex';
  private readonly chatSessionId?: string;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private playback = new StreamingPlayback();
  private duplexActive = false;
  private skipPlayback = false;
  private pendingChunkMeta: { sampleRate: number } | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(options: VoiceSessionClientOptions = {}) {
    this.events = options;
    this.mode = options.mode ?? 'push-to-talk';
    this.chatSessionId = options.chatSessionId;
  }

  getState(): VoiceClientState {
    return this.state;
  }

  private setState(state: VoiceClientState): void {
    this.state = state;
    this.events.onStateChange?.(state);
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && (this.state === 'ready' || this.state === 'listening')) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.setState('connecting');
    const token = await syncAuthTokenFromSession();
    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        fn();
      };

      const ws = new WebSocket(wsUrl(token));
      ws.binaryType = 'arraybuffer';

      const fail = (message: string) => {
        finish(() => {
          this.setState('error');
          this.events.onError?.(message);
          this.connectPromise = null;
          reject(new Error(message));
        });
      };

      const timeoutId = window.setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        fail('Voice connection timed out — finish voice setup in Settings and try again');
      }, VOICE_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        this.ws = ws;
        ws.send(JSON.stringify({
          type: 'session_start',
          mode: this.mode,
          sessionId: crypto.randomUUID(),
          ...(this.chatSessionId ? { chatSessionId: this.chatSessionId } : {}),
        }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          void this.handleBinary(event.data as ArrayBuffer);
          return;
        }
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (msg.type === 'session_ready') {
          this.handleControl(msg);
          this.setState(this.mode === 'duplex' ? 'listening' : 'ready');
          finish(() => {
            this.connectPromise = null;
            resolve();
          });
          return;
        }
        if (msg.type === 'error' && !settled) {
          const message = String(msg.message ?? 'Voice session failed to start');
          try { ws.close(); } catch { /* ignore */ }
          fail(message);
          return;
        }
        this.handleControl(msg);
      };

      ws.onerror = () => {
        fail(token
          ? 'Voice WebSocket connection failed'
          : 'Voice WebSocket connection failed — sign out and sign back in, then retry');
      };

      ws.onclose = (event) => {
        if (!settled) {
          fail(event.code === 1006 || event.code === 1008 || event.code === 401
            ? 'Voice WebSocket connection failed — your session may have expired'
            : `Voice connection closed (${event.code})`);
          return;
        }
        this.ws = null;
        this.connectPromise = null;
        this.setState('idle');
      };
    });

    return this.connectPromise;
  }

  async startListening(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    if (this.workletNode) return;

    this.skipPlayback = false;
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: VOICE_SAMPLE_RATE,
      },
    });
    this.audioContext = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    await this.audioContext.audioWorklet.addModule(VOICE_CAPTURE_PROCESSOR_URL);
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioContext, VOICE_CAPTURE_PROCESSOR_NAME);
    this.workletNode.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer }>) => {
      const pcm = new Int16Array(event.data.pcm);
      if (this.events.onAudioLevel) {
        let sum = 0;
        for (let i = 0; i < pcm.length; i += 1) sum += Math.abs(pcm[i]!);
        this.events.onAudioLevel(Math.min(1, sum / Math.max(1, pcm.length) / 8000));
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(pcm.buffer);
      }
      if (this.state === 'speaking') {
        this.interruptPlayback();
      }
    };
    source.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination);
    this.ws?.send(JSON.stringify({ type: 'audio_start' }));
    this.duplexActive = this.mode === 'duplex';
    this.setState('listening');
  }

  async stopListening(): Promise<void> {
    if (this.mode === 'duplex' && this.duplexActive) {
      return;
    }
    await this.stopCaptureOnly();
    this.ws?.send(JSON.stringify({ type: 'audio_end' }));
    this.setState('processing');
  }

  disconnect(): void {
    this.interruptPlayback();
    void this.playback.close();
    void this.stopCaptureOnly();
    this.ws?.send(JSON.stringify({ type: 'session_end' }));
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
    this.setState('idle');
  }

  interruptPlayback(): void {
    this.playback.stop();
    this.ws?.send(JSON.stringify({ type: 'playback_interrupted' }));
    if (this.mode === 'duplex') {
      this.setState('listening');
    }
  }

  setTextOnlyPlayback(enabled: boolean): void {
    this.skipPlayback = enabled;
    this.playback.stop();
    if (enabled) {
      this.ws?.send(JSON.stringify({ type: 'playback_text_only' }));
    }
  }

  async replayPlayback(): Promise<void> {
    markVoiceOutputUnlocked();
    await this.playback.replayLast();
    this.setState('speaking');
  }

  private async stopCaptureOnly(): Promise<void> {
    this.workletNode?.disconnect();
    this.workletNode = null;
    await this.audioContext?.close();
    this.audioContext = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  private handleControl(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'transcript_partial':
        this.events.onTranscriptPartial?.(String(msg.text ?? ''));
        break;
      case 'transcript_final':
        this.events.onTranscriptFinal?.(String(msg.text ?? ''), Boolean(msg.empty));
        break;
      case 'agent_status': {
        const status = String(msg.status ?? '');
        if (typeof msg.text === 'string' && msg.text.trim()) {
          this.events.onAgentText?.(msg.text.trim());
        }
        this.events.onAgentStatus?.(status);
        if (status === 'speaking') this.setState('speaking');
        if (status === 'complete') this.setState(this.mode === 'duplex' ? 'listening' : 'ready');
        if (status === 'running') this.setState('processing');
        break;
      }
      case 'audio_chunk_meta':
        this.pendingChunkMeta = { sampleRate: Number(msg.sampleRate ?? 24_000) };
        break;
      case 'audio_end':
        this.pendingChunkMeta = null;
        break;
      case 'duplex_silence':
        this.events.onDuplexSilence?.(
          Number(msg.elapsedMs ?? 0),
          Number(msg.thresholdMs ?? 5000),
        );
        break;
      case 'error':
        this.setState('error');
        this.events.onError?.(String(msg.message ?? 'Voice error'));
        break;
      default:
        break;
    }
  }

  private async handleBinary(data: ArrayBuffer): Promise<void> {
    const pcm = new Int16Array(data);
    if (this.events.onPlaybackLevel) {
      let sum = 0;
      for (let i = 0; i < pcm.length; i += 1) sum += Math.abs(pcm[i]!);
      this.events.onPlaybackLevel(Math.min(1, sum / Math.max(1, pcm.length) / 8000));
    }
    if (this.skipPlayback || !isVoiceOutputUnlocked()) return;
    markVoiceOutputUnlocked();
    const sampleRate = this.pendingChunkMeta?.sampleRate ?? 24_000;
    await this.playback.enqueuePcm(pcm, sampleRate);
    this.setState('speaking');
  }
}
