import { syncAuthTokenFromSession } from '../api';
import { collectClientSituation } from '../client-situation.js';
import { VOICE_SAMPLE_RATE, mergeInt16Chunks } from './pcm.js';
import { StreamingPlayback } from './playback.js';
import { VOICE_CAPTURE_PROCESSOR_NAME, VOICE_CAPTURE_PROCESSOR_URL } from './audioWorkletProcessor.js';
import { isVoiceOutputUnlocked, markVoiceOutputUnlocked } from './support.js';

export const VOICE_WS_PATH = '/ws/voice';
export { VOICE_SAMPLE_RATE };

const VOICE_CONNECT_TIMEOUT_MS = 120_000;
/** Duplex mode: batch mic frames before sending to avoid STT overload (~4 calls/s). */
const DUPLEX_SEND_INTERVAL_MS = 250;

export type VoiceClientState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export interface VoicePermissionPrompt {
  requestId: string;
  tool: string;
  riskLevel: string;
  argsSummary?: string;
  commandPreview?: string;
}

export type VoicePermissionChoice = 'allow_once' | 'allow_always' | 'deny' | 'approve_all';

export interface VoiceSessionClientEvents {
  onStateChange?: (state: VoiceClientState) => void;
  onTranscriptPartial?: (text: string) => void;
  onTranscriptFinal?: (text: string, empty?: boolean) => void;
  onTranscriptPending?: () => void;
  onAgentText?: (text: string) => void;
  onError?: (message: string) => void;
  onWarning?: (message: string) => void;
  onAgentStatus?: (status: string) => void;
  onAudioLevel?: (level: number) => void;
  onPlaybackLevel?: (level: number) => void;
  onDuplexSilence?: (elapsedMs: number, thresholdMs: number) => void;
  onVoiceTiming?: (timings: VoiceTurnTimings) => void;
  onPermissionPrompt?: (prompt: VoicePermissionPrompt) => void;
  onPermissionResolved?: (requestId: string, choice: string, reason?: string) => void;
  onRecordingDiscarded?: (reason: string) => void;
  onPlaybackIdle?: () => void;
}

export interface VoiceTurnTimings {
  sttMs: number;
  thinkingMs: number;
  ttsMs: number;
  totalMs: number;
  firstAudioMs: number;
}

export interface VoiceSessionClientOptions extends VoiceSessionClientEvents {
  mode?: 'push-to-talk' | 'duplex';
  authToken?: string | null;
  chatSessionId?: string;
  /** When true, use a segregated voice-only session (__channel__:voice) instead of a chat session. */
  voiceOnly?: boolean;
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
  private readonly voiceOnly: boolean;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private playback = new StreamingPlayback();
  private duplexActive = false;
  private duplexPendingChunks: Int16Array[] = [];
  private duplexFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private skipPlayback = false;
  private pendingChunkMeta: { sampleRate: number } | null = null;
  /** Duplex: true after `audio_end` until playback drains — signals server to resume mic. */
  private duplexAwaitingPlaybackEnd = false;
  private connectPromise: Promise<void> | null = null;
  private listenStartedAt = 0;
  /** PTT: mic graph is open but not streaming until armed. */
  private micPrepared = false;
  private captureArmed = false;

  constructor(options: VoiceSessionClientOptions = {}) {
    this.events = options;
    this.mode = options.mode ?? 'push-to-talk';
    this.chatSessionId = options.chatSessionId;
    this.voiceOnly = Boolean(options.voiceOnly);
    this.playback.setOnIdle(() => {
      this.events.onPlaybackLevel?.(0);
      this.events.onPlaybackIdle?.();
      // Duplex: notify the server that TTS playback has finished so it can
      // safely re-enable the microphone without picking up the agent's voice.
      if (this.mode === 'duplex' && this.duplexAwaitingPlaybackEnd) {
        this.duplexAwaitingPlaybackEnd = false;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'playback_finished' }));
        }
        // Now transition to listening — the server will resume the mic.
        this.setState('listening');
      }
    });
  }

  getState(): VoiceClientState {
    return this.state;
  }

  /** True when the voice WebSocket is open and the session is usable. */
  isLinkLive(): boolean {
    return (
      this.ws?.readyState === WebSocket.OPEN &&
      this.state !== 'idle' &&
      this.state !== 'error'
    );
  }

  isPlaybackActive(): boolean {
    return this.playback.playing;
  }

  isMicPrepared(): boolean {
    return this.micPrepared && this.workletNode !== null;
  }

  isPttReady(): boolean {
    return this.isLinkLive() && (this.mode === 'duplex' || this.isMicPrepared());
  }

  private setState(state: VoiceClientState): void {
    this.state = state;
    this.events.onStateChange?.(state);
  }

  async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.state !== 'idle' && this.state !== 'error') {
        return;
      }
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
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
        void collectClientSituation().then((clientSituation) => {
          ws.send(JSON.stringify({
            type: 'session_start',
            mode: this.mode,
            sessionId: crypto.randomUUID(),
            ...(this.voiceOnly ? { voiceOnly: true } : {}),
            ...(!this.voiceOnly && this.chatSessionId ? { chatSessionId: this.chatSessionId } : {}),
            clientSituation,
          }));
        });
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

  private flushDuplexAudio(): void {
    this.duplexFlushTimer = null;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.duplexPendingChunks.length === 0) {
      this.duplexPendingChunks = [];
      return;
    }
    const merged = mergeInt16Chunks(this.duplexPendingChunks);
    this.duplexPendingChunks = [];
    this.ws.send(merged.buffer);
  }

  private queueDuplexAudio(pcm: Int16Array): void {
    this.duplexPendingChunks.push(pcm);
    if (this.duplexFlushTimer !== null) return;
    this.duplexFlushTimer = setTimeout(() => this.flushDuplexAudio(), DUPLEX_SEND_INTERVAL_MS);
  }

  private clearDuplexSendBuffer(): void {
    if (this.duplexFlushTimer !== null) {
      clearTimeout(this.duplexFlushTimer);
      this.duplexFlushTimer = null;
    }
    this.duplexPendingChunks = [];
  }

  private onCapturePcm(pcm: Int16Array): void {
    const levelActive = this.mode === 'duplex' || this.captureArmed;
    if (this.events.onAudioLevel && levelActive) {
      let sum = 0;
      for (let i = 0; i < pcm.length; i += 1) sum += Math.abs(pcm[i]!);
      this.events.onAudioLevel(Math.min(1, sum / Math.max(1, pcm.length) / 8000));
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.mode === 'duplex') {
      if (this.state !== 'speaking') {
        this.queueDuplexAudio(pcm);
      }
      return;
    }
    if (!this.captureArmed) return;
    this.ws.send(pcm.buffer);
  }

  /** PTT: open mic hardware without starting a server recording. */
  async prepareMicrophone(): Promise<void> {
    if (this.mode === 'duplex') {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.connect();
      }
      if (this.state !== 'listening') {
        await this.startDuplexListening();
      }
      return;
    }
    if (this.isMicPrepared()) {
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }
      return;
    }
    if (this.workletNode) {
      await this.stopCaptureOnly();
    }

    this.skipPlayback = false;
    this.captureArmed = false;
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
      this.onCapturePcm(new Int16Array(event.data.pcm));
    };
    source.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination);
    this.micPrepared = true;
    if (this.state !== 'processing' && this.state !== 'speaking' && this.state !== 'connecting') {
      this.setState('ready');
    }
  }

  /** PTT: begin streaming mic audio to the server (mic must be prepared). */
  armCapture(): void {
    if (this.mode !== 'push-to-talk' || !this.isMicPrepared()) return;
    this.playback.clearHistory();
    this.captureArmed = true;
    this.listenStartedAt = Date.now();
    this.ws?.send(JSON.stringify({ type: 'audio_start' }));
    this.setState('listening');
  }

  private async startDuplexListening(): Promise<void> {
    if (this.workletNode) {
      await this.stopCaptureOnly();
    }
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
      this.onCapturePcm(new Int16Array(event.data.pcm));
    };
    source.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination);
    this.ws?.send(JSON.stringify({ type: 'audio_start' }));
    this.listenStartedAt = Date.now();
    this.duplexActive = true;
    this.micPrepared = true;
    this.captureArmed = true;
    this.setState('listening');
  }

  async startListening(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    if (this.mode === 'duplex') {
      await this.startDuplexListening();
      return;
    }
    await this.prepareMicrophone();
    this.armCapture();
  }

  async cancelListening(): Promise<void> {
    if (this.mode === 'duplex' && this.duplexActive) return;
    if (this.mode === 'push-to-talk') {
      this.captureArmed = false;
      this.listenStartedAt = 0;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'audio_cancel' }));
      }
      this.setState('ready');
      return;
    }
    await this.stopCaptureOnly();
    this.listenStartedAt = 0;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'audio_cancel' }));
    }
    this.setState(this.mode === 'duplex' ? 'listening' : 'ready');
  }

  getListenDurationMs(): number {
    if (!this.listenStartedAt) return 0;
    return Date.now() - this.listenStartedAt;
  }

  async stopListening(): Promise<void> {
    if (this.mode === 'duplex' && this.duplexActive) {
      return;
    }
    if (this.mode === 'push-to-talk') {
      this.captureArmed = false;
      this.listenStartedAt = 0;
      try {
        const clientSituation = await collectClientSituation();
        this.ws?.send(JSON.stringify({ type: 'client_situation', clientSituation }));
      } catch { /* best-effort */ }
      this.ws?.send(JSON.stringify({ type: 'audio_end' }));
      this.setState('processing');
      return;
    }
    await this.stopCaptureOnly();
    this.listenStartedAt = 0;
    try {
      const clientSituation = await collectClientSituation();
      this.ws?.send(JSON.stringify({ type: 'client_situation', clientSituation }));
    } catch { /* best-effort */ }
    this.ws?.send(JSON.stringify({ type: 'audio_end' }));
    this.setState('processing');
  }

  disconnect(): void {
    this.interruptPlayback();
    void this.playback.close();
    this.micPrepared = false;
    this.captureArmed = false;
    void this.stopCaptureOnly();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'session_end' }));
      this.ws.close();
    }
    this.ws = null;
    this.connectPromise = null;
    this.setState('idle');
  }

  interruptPlayback(): void {
    this.playback.stop();
    this.duplexAwaitingPlaybackEnd = false;
    this.ws?.send(JSON.stringify({ type: 'playback_interrupted' }));
    if (this.mode === 'duplex') {
      this.setState('listening');
    } else {
      this.setState('ready');
    }
  }

  respondToPermission(choice: VoicePermissionChoice): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'permission_response', choice }));
    }
  }

  setTextOnlyPlayback(enabled: boolean): void {
    this.skipPlayback = enabled;
    this.playback.stop();
    if (enabled) {
      this.ws?.send(JSON.stringify({ type: 'playback_text_only' }));
    }
  }

  /** Update voice-only session toggles (web search, bypass chip). */
  setToggles(toggles: { searchWeb?: boolean; bypassChip?: boolean }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'voice_toggle', ...toggles }));
    }
  }

  async replayPlayback(): Promise<void> {
    markVoiceOutputUnlocked();
    await this.playback.replayLast();
    this.setState('speaking');
  }

  private async stopCaptureOnly(): Promise<void> {
    this.clearDuplexSendBuffer();
    this.micPrepared = false;
    this.captureArmed = false;
    this.duplexActive = false;
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
      case 'transcript_pending':
        this.events.onTranscriptPending?.();
        break;
      case 'transcript_final': {
        const text = String(msg.text ?? '');
        const empty = Boolean(msg.empty);
        this.events.onTranscriptFinal?.(text, empty);
        if (empty || !text.trim()) {
          this.setState(this.mode === 'duplex' ? 'listening' : 'ready');
        } else if (!empty && text.trim()) {
          this.setState('processing');
        }
        break;
      }
      case 'agent_status': {
        const status = String(msg.status ?? '');
        if (typeof msg.text === 'string' && msg.text.trim()) {
          this.events.onAgentText?.(msg.text.trim());
        }
        this.events.onAgentStatus?.(status);
        if (status === 'speaking') this.setState('speaking');
        if (status === 'complete') {
          // In duplex mode, stay in 'speaking' until playback drains — the
          // onIdle callback will send `playback_finished` to the server which
          // resumes the mic. Transitioning to 'listening' here would cause the
          // client to stream mic audio while TTS is still playing.
          if (this.mode === 'duplex') {
            if (!this.playback.playing && !this.duplexAwaitingPlaybackEnd) {
              this.setState('listening');
            }
            // else: state transitions when onPlaybackIdle fires
          } else {
            this.setState('ready');
          }
        }
        if (status === 'running') this.setState('processing');
        // Server signalled duplex recovery — resync out of any stale error state.
        if (status === 'listening' && this.mode === 'duplex') this.setState('listening');
        break;
      }
      case 'audio_chunk_meta':
        this.pendingChunkMeta = { sampleRate: Number(msg.sampleRate ?? 24_000) };
        break;
      case 'audio_end':
        this.pendingChunkMeta = null;
        if (this.mode === 'duplex') {
          // If no TTS audio was queued (text-only turn), playback is already
          // idle — notify the server immediately so it can resume the mic.
          if (this.playback.playing) {
            this.duplexAwaitingPlaybackEnd = true;
          } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'playback_finished' }));
          }
        }
        break;
      case 'duplex_silence':
        this.events.onDuplexSilence?.(
          Number(msg.elapsedMs ?? 0),
          Number(msg.thresholdMs ?? 5000),
        );
        break;
      case 'voice_timing': {
        const sttMs = Number(msg.sttMs);
        const thinkingMs = Number(msg.thinkingMs);
        const ttsMs = Number(msg.ttsMs);
        const totalMs = Number(msg.totalMs);
        const firstAudioMs = Number(msg.firstAudioMs);
        if ([sttMs, thinkingMs, ttsMs, totalMs, firstAudioMs].every(Number.isFinite)) {
          this.events.onVoiceTiming?.({ sttMs, thinkingMs, ttsMs, totalMs, firstAudioMs });
        }
        break;
      }
      case 'permission_prompt':
        this.events.onPermissionPrompt?.({
          requestId: String(msg.requestId ?? ''),
          tool: String(msg.tool ?? 'tool'),
          riskLevel: String(msg.riskLevel ?? 'medium'),
          argsSummary: typeof msg.argsSummary === 'string' ? msg.argsSummary : undefined,
          commandPreview: typeof msg.commandPreview === 'string' ? msg.commandPreview : undefined,
        });
        break;
      case 'permission_resolved':
        this.events.onPermissionResolved?.(
          String(msg.requestId ?? ''),
          String(msg.choice ?? ''),
          typeof msg.reason === 'string' ? msg.reason : undefined,
        );
        break;
      case 'recording_discarded': {
        const reason = String(msg.reason ?? 'discarded');
        this.setState(this.mode === 'duplex' ? 'listening' : 'ready');
        this.events.onRecordingDiscarded?.(reason);
        break;
      }
      case 'voice_warning':
        // Recoverable hiccup (duplex STT/turn) — the server is still listening.
        // Surface a transient hint but keep the session alive.
        this.events.onWarning?.(String(msg.message ?? 'Voice hiccup'));
        if (this.mode === 'duplex' && this.state === 'error') {
          this.setState('listening');
        }
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
