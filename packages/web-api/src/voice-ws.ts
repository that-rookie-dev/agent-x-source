import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { VoiceService, WebSocketVoiceTransport } from '@agentx/engine';
import { validateVoiceWebSocketConnection } from './auth.js';
import { ensureSubscribed } from './ws.js';
import { registerWebSocketRoute } from './ws-upgrade-router.js';
import { getEngine, createAgent, destroyAgent } from './engine.js';
import { runAgentTurnAsync } from './chat-helpers.js';
import { getVoiceService, resetVoiceService } from './voice-runtime.js';

const SAMPLE_RATE = 16_000;
/** Continuous silence after speech before auto-send in duplex mode. */
export const DUPLEX_END_SILENCE_MS = 5_000;
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
        session.audioChunks = [];
        session.duplexSilenceMs = 0;
        session.textOnlyPlayback = false;
        await getVoiceService().streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
      }
      break;
    case 'audio_end':
      if (session) await finishTurn(ws, session);
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
    transport,
  });
  voiceSession.setState(mode === 'duplex' ? 'listening' : 'idle');
  ws.send(JSON.stringify({ type: 'session_ready', sessionId: voiceSession.sessionId, mode }));
}

async function handleDuplexChunk(ws: WebSocket, session: VoiceWsSession, chunk: Buffer): Promise<void> {
  if (session.speaking) {
    ws.send(JSON.stringify({ type: 'playback_interrupted' }));
    session.speaking = false;
    session.recording = true;
    await cancelActiveSynth(session);
  }

  const service = getVoiceService();
  const stream = await service.streamTranscribeChunk(chunk, SAMPLE_RATE);
  if (stream.partial) {
    session.duplexHadSpeech = true;
    ws.send(JSON.stringify({ type: 'transcript_partial', text: stream.partial }));
  }
  if (stream.isSpeech === true) {
    session.duplexHadSpeech = true;
    session.duplexSilenceMs = 0;
    ws.send(JSON.stringify({ type: 'duplex_silence', elapsedMs: 0, thresholdMs: DUPLEX_END_SILENCE_MS }));
  } else if (stream.isSpeech === false && session.duplexHadSpeech) {
    session.duplexSilenceMs += Math.round((chunk.length / 2 / SAMPLE_RATE) * 1000);
    ws.send(JSON.stringify({
      type: 'duplex_silence',
      elapsedMs: session.duplexSilenceMs,
      thresholdMs: DUPLEX_END_SILENCE_MS,
    }));
  }

  const silenceReached = session.duplexHadSpeech && session.duplexSilenceMs >= DUPLEX_END_SILENCE_MS;
  const shouldFinalize = session.duplexHadSpeech && (Boolean(stream.speechEnd) || silenceReached);
  if (shouldFinalize && session.audioChunks.length > 0) {
    session.recording = false;
    await finishTurn(ws, session);
    if (session.mode === 'duplex') {
      session.recording = true;
      session.audioChunks = [];
      session.duplexSilenceMs = 0;
      session.duplexHadSpeech = false;
      await service.streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
    }
  }
}

async function finishTurn(ws: WebSocket, session: VoiceWsSession): Promise<void> {
  session.recording = false;
  session.textOnlyPlayback = false;
  const service = getVoiceService();
  const voiceSession = service.getSession(session.sessionId);
  voiceSession?.setState('transcribing');

  const pcm = Buffer.concat(session.audioChunks);
  session.audioChunks = [];
  if (pcm.length === 0) {
    sendError(ws, 'No speech detected');
    voiceSession?.setState('idle');
    return;
  }

  try {
    const transcript = session.mode === 'duplex'
      ? await service.streamTranscribeChunk(pcm, SAMPLE_RATE, { finalize: true })
      : { text: (await service.transcribePcmBuffer(pcm, SAMPLE_RATE)).text };

    const text = transcript.text?.trim() ?? '';
    if (!text) {
      ws.send(JSON.stringify({ type: 'transcript_final', text: '', empty: true }));
      voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
      return;
    }

    ws.send(JSON.stringify({ type: 'transcript_final', text }));
    voiceSession?.setState('agent_running');
    ws.send(JSON.stringify({ type: 'agent_status', status: 'running' }));

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
    const unsub = agent.events.on((event) => {
      void progress.handleEngineEvent(event as { type?: string; stage?: string; tool?: string });
    });
    session.unsub = unsub;

    const turnId = randomUUID();
    runAgentTurnAsync(
      agent,
      text,
      undefined,
      false,
      turnId,
      sid,
      async (message) => {
        session.unsub?.();
        session.unsub = undefined;
        const content = extractAssistantText(message);
        if (!content) {
          ws.send(JSON.stringify({ type: 'agent_status', status: 'complete', empty: true }));
          voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
          return;
        }
        if (session.textOnlyPlayback) {
          ws.send(JSON.stringify({ type: 'agent_status', status: 'complete', textOnly: true }));
          voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
          if (session.mode === 'duplex') {
            session.recording = true;
          }
          return;
        }
        voiceSession?.setState('speaking');
        session.speaking = true;
        ws.send(JSON.stringify({ type: 'agent_status', status: 'speaking', text: content }));

        const synthId = randomUUID();
        session.activeSynthId = synthId;
        const stream = await service.synthesizeStreamText(content, { requestId: synthId });
        for (const chunk of stream.chunks) {
          if (session.activeSynthId !== stream.requestId) break;
          const audio = Buffer.from(chunk.pcmBase64, 'base64');
          await sendSessionAudio(session, audio, chunk.sampleRate, false);
        }
        ws.send(JSON.stringify({ type: 'audio_end' }));
        ws.send(JSON.stringify({ type: 'agent_status', status: 'complete' }));
        session.speaking = false;
        session.activeSynthId = undefined;
        voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
        if (session.mode === 'duplex') {
          session.recording = true;
        }
      },
      (error) => {
        session.unsub?.();
        session.speaking = false;
        sendError(ws, error);
        voiceSession?.fail(error);
      },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.includes('fetch failed') || raw.includes('ECONNREFUSED')
      ? 'Voice engine offline — verify setup in Settings → Voice and restart Agent-X'
      : raw;
    sendError(ws, message);
    voiceSession?.fail(error);
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
