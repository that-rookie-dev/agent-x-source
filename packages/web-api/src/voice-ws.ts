import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { VoiceService, WebSocketVoiceTransport } from '@agentx/engine';
import { VoiceStreamSpeakPipeline, VoiceTurnTimingTracker } from './voice-turn-tts.js';
import {
  VoiceBlockStreamExtractor,
  buildVoiceFallback,
  buildVoiceTurnInstruction,
  extractVoiceSpeakable,
} from './voice-speakable.js';
import { validateVoiceWebSocketConnection } from './auth.js';
import { ensureSubscribed } from './ws.js';
import { registerWebSocketRoute } from './ws-upgrade-router.js';
import { getEngine, createAgent, destroyAgent } from './engine.js';
import { runAgentTurnAsync } from './chat-helpers.js';
import { getVoiceService, resetVoiceService } from './voice-runtime.js';

const SAMPLE_RATE = 16_000;
/** Continuous silence after spoken words before auto-send in duplex mode. */
export const DUPLEX_END_SILENCE_MS = 5_000;
/** Minimum interval between streaming STT passes in duplex (avoids sidecar overload). */
const DUPLEX_STT_INTERVAL_MS = 350;
/** Minimum gap between duplicate error frames to the client. */
const DUPLEX_ERROR_COOLDOWN_MS = 8_000;
/** PTT shorter than this is treated as accidental (double-tap, mis-click). */
const MIN_PTT_RECORDING_MS = 1_000;

function hasMeaningfulWords(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  return /[\p{L}\p{N}]/u.test(trimmed);
}
let voiceWss: WebSocketServer | undefined;

interface VoiceWsSession {
  sessionId: string;
  chatSessionId?: string;
  mode: 'push-to-talk' | 'duplex';
  audioChunks: Buffer[];
  recording: boolean;
  speaking: boolean;
  textOnlyPlayback: boolean;
  activeSynthId?: string;
  duplexSilenceMs: number;
  duplexHadSpeech: boolean;
  /** True once STT produced real words — gap timer only runs after this. */
  duplexHadWords: boolean;
  duplexLastPartial: string;
  duplexLastWordAt: number;
  duplexLastSttAt: number;
  duplexTurnInFlight: boolean;
  duplexLastErrorAt: number;
  recordingStartedAt?: number;
  transport: WebSocketVoiceTransport;
  progress?: ReturnType<VoiceService['createProgressSession']>;
  unsub?: () => void;
}

const activeSessions = new Map<WebSocket, VoiceWsSession>();

async function sendSessionAudio(
  session: VoiceWsSession,
  audio: Buffer,
  sampleRate: number,
  filler = false,
): Promise<void> {
  if (session.textOnlyPlayback) return;
  await session.transport.playAudio(audio, sampleRate, { filler });
}

async function cancelActiveSynth(session: VoiceWsSession): Promise<void> {
  if (!session.activeSynthId) return;
  const client = await getVoiceService().getSidecarManager().start();
  await client.cancel({ requestId: session.activeSynthId });
  session.activeSynthId = undefined;
}

function pttRecordingDurationMs(session: VoiceWsSession): number {
  if (session.mode !== 'push-to-talk' || !session.recordingStartedAt) return 0;
  return Date.now() - session.recordingStartedAt;
}

function isAccidentalPttRecording(session: VoiceWsSession): boolean {
  return session.mode === 'push-to-talk' && pttRecordingDurationMs(session) < MIN_PTT_RECORDING_MS;
}

async function discardAccidentalPttRecording(ws: WebSocket, session: VoiceWsSession): Promise<void> {
  session.recording = false;
  session.audioChunks = [];
  session.recordingStartedAt = undefined;
  const voiceSession = getVoiceService().getSession(session.sessionId);
  voiceSession?.setState('idle');
  ws.send(JSON.stringify({ type: 'recording_discarded', reason: 'too_short' }));
}

export function setupVoiceWebSocket(_server: Server): void {
  voiceWss = new WebSocketServer({
    noServer: true,
    verifyClient: (info, cb) => {
      try {
        if (validateVoiceWebSocketConnection(info.req)) {
          cb(true);
        } else {
          cb(false, 401, 'Unauthorized');
        }
      } catch {
        cb(false, 401, 'Unauthorized');
      }
    },
  });
  registerWebSocketRoute('/ws/voice', voiceWss);

  voiceWss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }));
    ws.on('message', (data, isBinary) => {
      void handleVoiceMessage(ws, data, isBinary);
    });
    ws.on('close', () => {
      cleanupSession(ws);
    });
  });
}

async function handleVoiceMessage(ws: WebSocket, data: WebSocket.RawData, isBinary: boolean): Promise<void> {
  const session = activeSessions.get(ws);
  if (isBinary) {
    if (!session?.recording) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    session.audioChunks.push(chunk);

    if (session.mode === 'duplex') {
      await handleDuplexChunk(ws, session, chunk);
    }
    return;
  }

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(String(data));
  } catch {
    sendError(ws, 'Invalid JSON control frame');
    return;
  }

  switch (msg.type) {
    case 'session_start':
      try {
        await startSession(ws, msg);
      } catch (err) {
        sendError(ws, err instanceof Error ? err.message : String(err));
      }
      break;
    case 'audio_start':
      if (session) {
        session.recording = true;
        session.recordingStartedAt = Date.now();
        session.audioChunks = [];
        session.duplexSilenceMs = 0;
        session.duplexHadSpeech = false;
        session.duplexHadWords = false;
        session.duplexLastPartial = '';
        session.duplexLastWordAt = 0;
        session.duplexTurnInFlight = false;
        session.textOnlyPlayback = false;
        await getVoiceService().streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
      }
      break;
    case 'audio_end':
      if (session) await finishTurn(ws, session);
      break;
    case 'audio_cancel':
      if (session) await discardAccidentalPttRecording(ws, session);
      break;
    case 'playback_interrupted':
      if (session) {
        session.progress?.reset();
        await cancelActiveSynth(session);
        session.speaking = false;
        if (session.mode === 'duplex') {
          session.recording = true;
        }
      }
      break;
    case 'playback_text_only':
      if (session) {
        session.textOnlyPlayback = true;
        session.progress?.reset();
        await cancelActiveSynth(session);
        session.speaking = false;
        ws.send(JSON.stringify({ type: 'agent_status', status: 'complete', textOnly: true }));
        if (session.mode === 'duplex') {
          session.recording = true;
        }
      }
      break;
    case 'session_end':
      cleanupSession(ws);
      ws.close();
      break;
    default:
      sendError(ws, `Unknown control frame: ${String(msg.type)}`);
  }
}

async function ensureChatSessionActive(chatSessionId: string): Promise<boolean> {
  const eng = getEngine();
  const peek = eng.sessionManager.getSessionById(chatSessionId);
  if (!peek) return false;

  const existingAgent = eng.agent;
  const keepAgent = !!existingAgent
    && (existingAgent as unknown as { sessionId: string }).sessionId === chatSessionId
    && !existingAgent.processing;
  if (keepAgent) return true;

  destroyAgent();
  const session = eng.sessionManager.restoreSession(chatSessionId);
  if (!session) return false;
  createAgent(undefined, session);
  ensureSubscribed();
  return true;
}

async function resolveVoiceChatSessionId(preferred?: string): Promise<string | undefined> {
  if (preferred) return preferred;
  const eng = getEngine();
  const active = eng.sessionManager.getActiveSession()?.id;
  if (active) return active;
  const mgr = eng.sessionManager as unknown as {
    findAgentXCoreSession?: () => { id: string } | null;
  };
  return mgr.findAgentXCoreSession?.()?.id;
}

async function startSession(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
  const service = getVoiceService();
  const config = service.getConfig();
  if (!config.enabled) {
    sendError(ws, 'Voice is disabled');
    return;
  }

  try {
    await service.start();
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const offline = raw.includes('fetch failed') || raw.includes('ECONNREFUSED') || raw.includes('No module named');
    const message = offline
      ? 'Voice engine offline — open Settings → Voice and run setup, then reopen comms'
      : raw;
    sendError(ws, message);
    return;
  }
  void service.warmFillerCache();

  const mode = msg.mode === 'duplex' ? 'duplex' : 'push-to-talk';
  const chatSessionId = typeof msg.chatSessionId === 'string' ? msg.chatSessionId : undefined;
  const voiceWsSessionId = String(msg.sessionId ?? randomUUID());
  const voiceSession = service.createSession({ transport: 'web', mode, sessionId: voiceWsSessionId });
  const transport = new WebSocketVoiceTransport({ ws, sessionId: voiceWsSessionId, mode });
  activeSessions.set(ws, {
    sessionId: voiceSession.sessionId,
    chatSessionId,
    mode,
    audioChunks: [],
    recording: mode === 'duplex',
    speaking: false,
    textOnlyPlayback: false,
    duplexSilenceMs: 0,
    duplexHadSpeech: false,
    duplexHadWords: false,
    duplexLastPartial: '',
    duplexLastWordAt: 0,
    duplexLastSttAt: 0,
    duplexTurnInFlight: false,
    duplexLastErrorAt: 0,
    transport,
  });
  voiceSession.setState(mode === 'duplex' ? 'listening' : 'idle');
  ws.send(JSON.stringify({ type: 'session_ready', sessionId: voiceSession.sessionId, mode }));
}

async function handleDuplexChunk(ws: WebSocket, session: VoiceWsSession, chunk: Buffer): Promise<void> {
  if (session.duplexTurnInFlight) return;

  if (session.speaking) {
    ws.send(JSON.stringify({ type: 'playback_interrupted' }));
    session.speaking = false;
    session.recording = true;
    await cancelActiveSynth(session);
  }

  const now = Date.now();
  if (now - session.duplexLastSttAt < DUPLEX_STT_INTERVAL_MS) {
    return;
  }
  session.duplexLastSttAt = now;

  const service = getVoiceService();
  let stream: Awaited<ReturnType<typeof service.streamTranscribeChunk>>;
  try {
    stream = await service.streamTranscribeChunk(chunk, SAMPLE_RATE);
  } catch (err) {
    if (now - session.duplexLastErrorAt >= DUPLEX_ERROR_COOLDOWN_MS) {
      session.duplexLastErrorAt = now;
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.includes('fetch failed') || raw.includes('ECONNREFUSED')
        ? 'Voice STT temporarily unavailable — keep speaking or switch to push-to-talk'
        : raw;
      sendError(ws, message);
    }
    return;
  }

  const partial = stream.partial?.trim() ?? '';
  const wordsNow = partial || stream.text?.trim() || '';

  if (hasMeaningfulWords(wordsNow)) {
    if (wordsNow !== session.duplexLastPartial) {
      session.duplexLastPartial = wordsNow;
      session.duplexLastWordAt = now;
      session.duplexHadWords = true;
      session.duplexHadSpeech = true;
      session.duplexSilenceMs = 0;
      ws.send(JSON.stringify({ type: 'duplex_silence', elapsedMs: 0, thresholdMs: DUPLEX_END_SILENCE_MS }));
    }
    if (partial) {
      ws.send(JSON.stringify({ type: 'transcript_partial', text: partial }));
    }
  } else if (session.duplexHadWords && session.duplexLastWordAt > 0) {
    session.duplexSilenceMs = now - session.duplexLastWordAt;
    ws.send(JSON.stringify({
      type: 'duplex_silence',
      elapsedMs: session.duplexSilenceMs,
      thresholdMs: DUPLEX_END_SILENCE_MS,
    }));
  }

  const silenceReached = session.duplexHadWords
    && session.duplexLastWordAt > 0
    && session.duplexSilenceMs >= DUPLEX_END_SILENCE_MS;
  const shouldFinalize = session.duplexHadWords && silenceReached;

  if (shouldFinalize && session.audioChunks.length > 0 && !session.duplexTurnInFlight) {
    session.recording = false;
    await finishTurn(ws, session);
  }
}

async function resetDuplexListening(session: VoiceWsSession): Promise<void> {
  session.recording = true;
  session.duplexTurnInFlight = false;
  session.audioChunks = [];
  session.duplexSilenceMs = 0;
  session.duplexHadSpeech = false;
  session.duplexHadWords = false;
  session.duplexLastPartial = '';
  session.duplexLastWordAt = 0;
  try {
    await getVoiceService().streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
  } catch { /* best-effort */ }
}

async function finishTurn(ws: WebSocket, session: VoiceWsSession): Promise<void> {
  if (session.mode === 'duplex') {
    session.duplexTurnInFlight = true;
  }
  session.recording = false;
  session.textOnlyPlayback = false;
  const service = getVoiceService();
  const voiceSession = service.getSession(session.sessionId);
  voiceSession?.setState('transcribing');

  const pcm = Buffer.concat(session.audioChunks);
  session.audioChunks = [];
  if (pcm.length === 0) {
    if (session.mode === 'duplex' || isAccidentalPttRecording(session)) {
      voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
      session.recordingStartedAt = undefined;
      if (session.mode === 'duplex') {
        await resetDuplexListening(session);
      } else {
        ws.send(JSON.stringify({ type: 'recording_discarded', reason: 'too_short' }));
      }
      return;
    }
    sendError(ws, 'No speech detected');
    voiceSession?.setState('idle');
    return;
  }

  const timings = new VoiceTurnTimingTracker();
  try {
    const transcript = session.mode === 'duplex'
      ? await service.streamTranscribeChunk(pcm, SAMPLE_RATE, { finalize: true })
      : { text: (await service.transcribePcmBuffer(pcm, SAMPLE_RATE)).text };
    timings.markSttDone();

    const text = transcript.text?.trim() ?? '';
    if (!text) {
      if (isAccidentalPttRecording(session)) {
        await discardAccidentalPttRecording(ws, session);
        return;
      }
      ws.send(JSON.stringify({ type: 'transcript_final', text: '', empty: true }));
      voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
      if (session.mode === 'duplex') {
        await resetDuplexListening(session);
      }
      return;
    }

    ws.send(JSON.stringify({ type: 'transcript_final', text }));

    const chatSessionId = await resolveVoiceChatSessionId(session.chatSessionId);
    if (!chatSessionId) {
      sendError(ws, 'No chat session available for voice');
      voiceSession?.setState('idle');
      return;
    }
    const sessionReady = await ensureChatSessionActive(chatSessionId);
    if (!sessionReady) {
      sendError(ws, 'Chat session not found');
      voiceSession?.setState('idle');
      return;
    }

    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) {
      sendError(ws, 'Agent is not ready');
      voiceSession?.setState('idle');
      return;
    }
    const sid = chatSessionId;
    ensureSubscribed();

    const progress = service.createProgressSession(async (line: string) => {
      if (session.textOnlyPlayback) return;
      const fillerId = randomUUID();
      session.activeSynthId = fillerId;
      const stream = await service.synthesizeStreamText(line, { forFiller: true, requestId: fillerId });
      for (const chunk of stream.chunks) {
        if (session.activeSynthId !== stream.requestId) break;
        const audio = Buffer.from(chunk.pcmBase64, 'base64');
        await sendSessionAudio(session, audio, chunk.sampleRate, true);
      }
      if (session.activeSynthId === stream.requestId) {
        session.activeSynthId = undefined;
      }
    }, { transcript: text });
    session.progress = progress;

    let agentDisplayText = '';
    let firstSpeakStatusSent = false;
    const voiceExtractor = new VoiceBlockStreamExtractor();
    const speakPipeline = new VoiceStreamSpeakPipeline(async (unit) => {
      if (session.textOnlyPlayback) return;
      const t0 = Date.now();
      if (!firstSpeakStatusSent) {
        firstSpeakStatusSent = true;
        timings.markFirstAudio();
        voiceSession?.setState('speaking');
        session.speaking = true;
        ws.send(JSON.stringify({
          type: 'agent_status',
          status: 'speaking',
          text: agentDisplayText.trim() || undefined,
        }));
      }
      const synthId = randomUUID();
      session.activeSynthId = synthId;
      const stream = await service.synthesizeStreamText(unit, { requestId: synthId });
      for (const chunk of stream.chunks) {
        if (session.activeSynthId !== stream.requestId) break;
        const audio = Buffer.from(chunk.pcmBase64, 'base64');
        await sendSessionAudio(session, audio, chunk.sampleRate, false);
      }
      if (session.activeSynthId === synthId) {
        session.activeSynthId = undefined;
      }
      timings.addTtsMs(Date.now() - t0);
    });

    const unsub = agent.events.on((event) => {
      const ev = event as { type?: string; content?: string; stage?: string; tool?: string };
      if (ev.type === 'stream_chunk' && typeof ev.content === 'string' && ev.content) {
        agentDisplayText += ev.content;
        const speakDelta = voiceExtractor.pullSpeakDelta(ev.content);
        if (speakDelta) speakPipeline.feed(speakDelta);
      }
      void progress.handleEngineEvent(ev);
    });
    session.unsub = unsub;

    voiceSession?.setState('agent_running');
    ws.send(JSON.stringify({ type: 'agent_status', status: 'running' }));
    timings.markAgentStarted();

    const sendTimings = () => {
      ws.send(JSON.stringify({ type: 'voice_timing', ...timings.snapshot() }));
    };

    const turnId = randomUUID();
    runAgentTurnAsync(
      agent,
      text,
      buildVoiceTurnInstruction(),
      false,
      turnId,
      sid,
      async (message) => {
        session.unsub?.();
        session.unsub = undefined;
        const content = extractAssistantText(message);
        const { voice, chat } = extractVoiceSpeakable(content);
        if (content) {
          agentDisplayText = chat || content;
        }

        const completeVoiceTurn = async () => {
          sendTimings();
          ws.send(JSON.stringify({ type: 'audio_end' }));
          ws.send(JSON.stringify({
            type: 'agent_status',
            status: 'complete',
            text: agentDisplayText.trim() || undefined,
          }));
          session.speaking = false;
          session.activeSynthId = undefined;
          voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
          if (session.mode === 'duplex') {
            void resetDuplexListening(session);
          }
        };

        if (!content?.trim()) {
          ws.send(JSON.stringify({ type: 'agent_status', status: 'complete', empty: true }));
          sendTimings();
          voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
          if (session.mode === 'duplex') {
            void resetDuplexListening(session);
          }
          return;
        }
        if (session.textOnlyPlayback) {
          ws.send(JSON.stringify({
            type: 'agent_status',
            status: 'complete',
            textOnly: true,
            text: chat || content,
          }));
          sendTimings();
          voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
          if (session.mode === 'duplex') {
            void resetDuplexListening(session);
          }
          return;
        }

        const speakText = voice || buildVoiceFallback(chat || content);
        if (speakPipeline.streamed || voiceExtractor.closed) {
          await speakPipeline.flush();
        } else {
          await speakPipeline.flush(speakText);
        }
        await completeVoiceTurn();
      },
      (error) => {
        session.unsub?.();
        session.speaking = false;
        if (session.mode === 'duplex') {
          void resetDuplexListening(session);
        }
        const now = Date.now();
        if (now - session.duplexLastErrorAt >= DUPLEX_ERROR_COOLDOWN_MS) {
          session.duplexLastErrorAt = now;
          sendError(ws, error);
        }
        voiceSession?.fail(error);
      },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.includes('fetch failed') || raw.includes('ECONNREFUSED')
      ? 'Voice engine offline — verify setup in Settings → Voice and restart Agent-X'
      : raw;
    const now = Date.now();
    if (session.mode !== 'duplex' || now - session.duplexLastErrorAt >= DUPLEX_ERROR_COOLDOWN_MS) {
      session.duplexLastErrorAt = now;
      sendError(ws, message);
    }
    if (session.mode === 'duplex') {
      voiceSession?.setState('listening');
      await resetDuplexListening(session);
    } else {
      voiceSession?.fail(error);
    }
  }
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.parts)) {
    return record.parts
      .map((part) => (typeof part === 'object' && part && 'text' in part ? String((part as { text?: string }).text ?? '') : ''))
      .join('\n')
      .trim();
  }
  return '';
}

function cleanupSession(ws: WebSocket): void {
  const session = activeSessions.get(ws);
  if (!session) return;
  session.unsub?.();
  void session.transport.close();
  getVoiceService().closeSession(session.sessionId);
  activeSessions.delete(ws);
}

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }));
  }
}

export async function shutdownVoiceWebSocket(): Promise<void> {
  for (const ws of activeSessions.keys()) {
    ws.close();
  }
  activeSessions.clear();
  try {
    await getVoiceService().stop();
  } catch { /* sidecar may never have started */ }
  resetVoiceService();
  voiceWss?.close();
  voiceWss = undefined;
}

export { extractAssistantText };
