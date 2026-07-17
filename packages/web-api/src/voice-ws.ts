import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { VoiceService, WebSocketVoiceTransport } from '@agentx/engine';
import { VoiceStreamSpeakPipeline, VoiceTurnTimingTracker } from './voice-turn-tts.js';
import {
  VoiceBlockStreamExtractor,
  buildVoiceFallback,
  buildVoiceSummaryPhaseInstruction,
  buildVoiceFollowUpPhaseInstruction,
  buildVoiceChatReportPhaseInstruction,
  extractVoiceSpeakable,
  isVoiceSummaryOnlyMessage,
  userWantsVoiceChatReport,
  isAffirmativeReply,
  voiceOfferedChatReport,
} from './voice-speakable.js';
import { validateVoiceWebSocketConnection } from './auth.js';
import { ensureSubscribed } from './ws.js';
import { registerWebSocketRoute } from './ws-upgrade-router.js';
import { getEngine, createAgent, destroyAgent, setCurrentClientSituation } from './engine.js';
import { runAgentTurnAsync, VOICE_TURN_TIMEOUT_MS, VOICE_TURN_MAX_MS } from './chat-helpers.js';
import { getVoiceService, resetVoiceService } from './voice-runtime.js';
import { parseVoicePermissionIntent, type VoicePermissionIntent } from './voice-permission-intent.js';
import { normalizeClientSituation, getAgentFilesDir } from '@agentx/shared';
import type { ProviderId } from '@agentx/shared';
import { normalizeVoiceAssistantContent } from './voice-speakable.js';
import { refreshAgentPersona } from './chat-helpers.js';
import type { ClientSituation } from '@agentx/shared';

const SAMPLE_RATE = 16_000;
/** Minimum interval between streaming STT preview passes (PTT + duplex). */
const STT_PREVIEW_INTERVAL_MS = 200;
/** Continuous silence after spoken words before auto-send in duplex mode. */
export const DUPLEX_END_SILENCE_MS = 5_000;
/** Minimum gap between duplicate error frames to the client. */
const DUPLEX_ERROR_COOLDOWN_MS = 8_000;
/** PTT shorter than this is treated as accidental (mis-click). */
const MIN_PTT_RECORDING_MS = 220;
/** Auto-deny a voice permission prompt if the user doesn't respond in time. */
const VOICE_PERMISSION_TIMEOUT_MS = 45_000;

interface PendingVoicePermission {
  requestId: string;
  tool: string;
  riskLevel: string;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

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
  /** PTT live-caption throttle (duplex reuses duplexLastSttAt). */
  pttLastSttAt: number;
  pttLastPartial: string;
  recordingStartedAt?: number;
  transport: WebSocketVoiceTransport;
  progress?: ReturnType<VoiceService['createProgressSession']>;
  unsub?: () => void;
  /** Active voice-native permission prompt awaiting a spoken/tapped decision. */
  pendingPermission?: PendingVoicePermission;
  clientSituation?: ClientSituation;
  /** Toggle: force web search for this voice turn. */
  searchWeb: boolean;
  /** Toggle: auto-approve tool permissions (bypass chip). */
  bypassChip: boolean;
  /** Duplex: pending timer waiting for client playback-finished signal before re-enabling mic. */
  duplexPlaybackResetTimer?: ReturnType<typeof setTimeout>;
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

/** Speak a short line of text out-of-band (permission prompts, confirmations). */
async function speakSystemLine(session: VoiceWsSession, line: string): Promise<void> {
  if (session.textOnlyPlayback || !line.trim()) return;
  const service = getVoiceService();
  const synthId = randomUUID();
  session.activeSynthId = synthId;
  try {
    const stream = await service.synthesizeStreamText(line, { requestId: synthId });
    for (const chunk of stream.chunks) {
      if (session.activeSynthId !== stream.requestId) break;
      const audio = Buffer.from(chunk.pcmBase64, 'base64');
      await sendSessionAudio(session, audio, chunk.sampleRate, false);
    }
  } catch { /* best-effort TTS */ } finally {
    if (session.activeSynthId === synthId) session.activeSynthId = undefined;
  }
}

function buildPermissionSpokenPrompt(tool: string, riskLevel: string, argsSummary?: string): string {
  const action = argsSummary
    ? argsSummary
    : `use the ${tool.replace(/_/g, ' ')} tool`;
  const riskNote = riskLevel === 'critical' || riskLevel === 'high'
    ? ' This is a higher-risk action.'
    : '';
  return `Agent-X wants to ${action}.${riskNote} Say allow, always, or deny.`;
}

/** Clear any pending permission prompt (on resolve, timeout, or session teardown). */
function clearPendingPermission(session: VoiceWsSession): void {
  if (session.pendingPermission) {
    clearTimeout(session.pendingPermission.timeoutTimer);
    session.pendingPermission = undefined;
  }
}

/**
 * Apply a voice permission decision to the agent and notify the client.
 * Returns true if a pending prompt existed and was resolved.
 */
async function resolveVoicePermission(
  ws: WebSocket,
  session: VoiceWsSession,
  intent: VoicePermissionIntent,
): Promise<boolean> {
  const pending = session.pendingPermission;
  if (!pending) return false;

  const eng = getEngine();
  const agent = eng.agent;
  const choice = intent === 'approve_all' ? 'allow_once' : intent;

  try {
    if (intent === 'approve_all') {
      agent?.respondToPermissionBatch('allow_once');
    } else {
      agent?.respondToPermission(pending.requestId, choice);
    }
  } catch { /* best-effort */ }

  clearPendingPermission(session);
  ws.send(JSON.stringify({ type: 'permission_resolved', requestId: pending.requestId, choice: intent }));

  const spoken = intent === 'deny'
    ? 'Denied. I will skip that step.'
    : intent === 'allow_always'
      ? 'Always allowed.'
      : intent === 'approve_all'
        ? 'Approved everything.'
        : 'Allowed.';
  await speakSystemLine(session, spoken);
  return true;
}

/** A tool needs approval mid-turn — prompt the operator by voice and open a decision window. */
async function handleVoicePermissionRequired(
  ws: WebSocket,
  session: VoiceWsSession,
  req: { requestId: string; tool: string; riskLevel: string; argsSummary?: string; commandPreview?: string },
): Promise<void> {
  // Only one prompt at a time; ignore duplicates for the same request.
  if (session.pendingPermission?.requestId === req.requestId) return;
  clearPendingPermission(session);

  // Stop any in-flight agent speech so the prompt is heard clearly.
  await cancelActiveSynth(session);
  session.speaking = false;

  const timeoutTimer = setTimeout(() => {
    void (async () => {
      const pending = session.pendingPermission;
      if (!pending || pending.requestId !== req.requestId) return;
      try { getEngine().agent?.respondToPermission(req.requestId, 'deny'); } catch { /* best-effort */ }
      clearPendingPermission(session);
      ws.send(JSON.stringify({ type: 'permission_resolved', requestId: req.requestId, choice: 'deny', reason: 'timeout' }));
      await speakSystemLine(session, 'No response, so I skipped that step.');
    })();
  }, VOICE_PERMISSION_TIMEOUT_MS);

  session.pendingPermission = {
    requestId: req.requestId,
    tool: req.tool,
    riskLevel: req.riskLevel,
    timeoutTimer,
  };

  ws.send(JSON.stringify({
    type: 'permission_prompt',
    requestId: req.requestId,
    tool: req.tool,
    riskLevel: req.riskLevel,
    argsSummary: req.argsSummary,
    commandPreview: req.commandPreview,
  }));

  await speakSystemLine(session, buildPermissionSpokenPrompt(req.tool, req.riskLevel, req.argsSummary));

  // Re-open the mic so the operator can answer hands-free.
  if (session.mode === 'duplex') {
    await resetDuplexListening(session);
  }
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
    } else if (session.mode === 'push-to-talk') {
      await handlePttChunk(ws, session);
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
        session.pttLastSttAt = 0;
        session.pttLastPartial = '';
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
          if (session.duplexPlaybackResetTimer) {
            clearTimeout(session.duplexPlaybackResetTimer);
            session.duplexPlaybackResetTimer = undefined;
          }
          session.recording = true;
        }
      }
      break;
    case 'playback_finished':
      if (session && session.mode === 'duplex') {
        await handlePlaybackFinished(ws, session);
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
    case 'permission_response':
      if (session && session.pendingPermission) {
        const choice = String(msg.choice ?? '');
        const intent: VoicePermissionIntent | null =
          choice === 'allow_once' || choice === 'allow_always' || choice === 'deny' || choice === 'approve_all'
            ? choice
            : null;
        if (intent) await resolveVoicePermission(ws, session, intent);
      }
      break;
    case 'client_situation':
      if (session) {
        const situation = normalizeClientSituation(msg.clientSituation ?? msg);
        if (situation) {
          session.clientSituation = situation;
          setCurrentClientSituation(situation);
        }
      }
      break;
    case 'voice_toggle':
      if (session) {
        if (typeof msg.searchWeb === 'boolean') session.searchWeb = msg.searchWeb;
        if (typeof msg.bypassChip === 'boolean') {
          session.bypassChip = msg.bypassChip;
          // Apply bypass immediately to the active agent so it takes effect on the next turn.
          const eng = getEngine();
          eng.agent?.setBypassPermissions?.(msg.bypassChip);
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
  let peek = eng.sessionManager.getSessionById(chatSessionId);

  // For the segregated voice-only session (__channel__:voice), create it if it doesn't exist yet.
  if (!peek && chatSessionId === '__channel__:voice') {
    const cfg = eng.configManager.load();
    const voiceProvider = cfg.voice?.provider;
    const providerId = (voiceProvider?.activeProvider as ProviderId) || cfg.provider.activeProvider;
    const modelId = voiceProvider?.activeModel || cfg.provider.activeModel;
    const scope = getAgentFilesDir();
    try {
      eng.sessionManager.createSession(
        providerId,
        modelId,
        scope,
        chatSessionId,
      );
      peek = eng.sessionManager.getSessionById(chatSessionId);
    } catch {
      return false;
    }
  }
  if (!peek) return false;

  const existingAgent = eng.agent;
  const keepAgent = !!existingAgent
    && existingAgent.sessionId === chatSessionId
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
  return eng.sessionManager.findAgentXCoreSession()?.id;
}

async function startSession(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
  const prior = activeSessions.get(ws);
  if (prior) {
    prior.unsub?.();
    void prior.transport.close();
    getVoiceService().closeSession(prior.sessionId);
    activeSessions.delete(ws);
  }

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
  const voiceOnly = Boolean(msg.voiceOnly);
  const chatSessionId = voiceOnly
    ? '__channel__:voice'
    : (typeof msg.chatSessionId === 'string' ? msg.chatSessionId : undefined);
  const voiceWsSessionId = String(msg.sessionId ?? randomUUID());
  const clientSituation = normalizeClientSituation(msg.clientSituation);
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
    pttLastSttAt: 0,
    pttLastPartial: '',
    transport,
    searchWeb: false,
    bypassChip: false,
    ...(clientSituation ? { clientSituation } : {}),
  });
  voiceSession.setState(mode === 'duplex' ? 'listening' : 'idle');
  ws.send(JSON.stringify({ type: 'session_ready', sessionId: voiceSession.sessionId, mode }));
}

async function requestTranscriptPreview(
  ws: WebSocket,
  session: VoiceWsSession,
  options: { throttleKey: 'duplex' | 'ptt' },
): Promise<{ partial: string; wordsNow: string } | null> {
  const now = Date.now();
  const lastAt = options.throttleKey === 'duplex' ? session.duplexLastSttAt : session.pttLastSttAt;
  if (now - lastAt < STT_PREVIEW_INTERVAL_MS) return null;

  const cumulative = Buffer.concat(session.audioChunks);
  if (cumulative.length < SAMPLE_RATE * 2 * 0.3) return null;

  if (options.throttleKey === 'duplex') session.duplexLastSttAt = now;
  else session.pttLastSttAt = now;

  // For preview requests, only send the trailing ~5s of audio — the Python
  // sidecar's preview mode only decodes the tail anyway, so sending the full
  // cumulative buffer wastes bandwidth and increases latency on longer turns.
  const maxPreviewBytes = SAMPLE_RATE * 2 * 5; // 5s @ 16kHz mono s16
  const previewPcm = cumulative.length > maxPreviewBytes
    ? cumulative.subarray(cumulative.length - maxPreviewBytes)
    : cumulative;

  const service = getVoiceService();
  let stream: Awaited<ReturnType<typeof service.streamTranscribeChunk>>;
  try {
    stream = await service.streamTranscribeChunk(previewPcm, SAMPLE_RATE, { preview: true });
  } catch (err) {
    if (options.throttleKey === 'duplex' && now - session.duplexLastErrorAt >= DUPLEX_ERROR_COOLDOWN_MS) {
      session.duplexLastErrorAt = now;
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.includes('fetch failed') || raw.includes('ECONNREFUSED')
        ? 'Voice STT temporarily unavailable — keep speaking or switch to push-to-talk'
        : raw;
      sendWarning(ws, message);
    }
    return null;
  }

  const partial = stream.partial?.trim() ?? '';
  const wordsNow = partial || stream.text?.trim() || '';
  return { partial, wordsNow };
}

async function handlePttChunk(ws: WebSocket, session: VoiceWsSession): Promise<void> {
  const preview = await requestTranscriptPreview(ws, session, { throttleKey: 'ptt' });
  if (!preview) return;

  const { partial } = preview;
  if (!partial || partial === session.pttLastPartial) return;
  session.pttLastPartial = partial;
  ws.send(JSON.stringify({ type: 'transcript_partial', text: partial }));
}

async function handleDuplexChunk(ws: WebSocket, session: VoiceWsSession, _chunk: Buffer): Promise<void> {
  if (session.duplexTurnInFlight) return;

  if (session.speaking) {
    // Agent is speaking — ignore mic chunks (prevents echo/noise from cutting off TTS).
    return;
  }

  const now = Date.now();
  const preview = await requestTranscriptPreview(ws, session, { throttleKey: 'duplex' });
  if (!preview) return;

  const { partial, wordsNow } = preview;

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
  session.pttLastPartial = '';
  session.pttLastSttAt = 0;
  try {
    await getVoiceService().streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
  } catch { /* best-effort */ }
}

/**
 * Duplex: schedule re-enablement of the microphone after the client confirms
 * TTS playback has finished. A fallback timer ensures we eventually resume even
 * if the client never sends `playback_finished` (e.g. text-only turns).
 */
function scheduleDuplexResume(_ws: WebSocket, session: VoiceWsSession): void {
  if (session.duplexPlaybackResetTimer) clearTimeout(session.duplexPlaybackResetTimer);
  // Fallback: resume after 3s even without explicit client confirmation.
  session.duplexPlaybackResetTimer = setTimeout(() => {
    session.duplexPlaybackResetTimer = undefined;
    void resetDuplexListening(session);
  }, 3000);
}

/** Duplex: client confirmed TTS playback finished — resume listening immediately. */
async function handlePlaybackFinished(_ws: WebSocket, session: VoiceWsSession): Promise<void> {
  if (session.duplexPlaybackResetTimer) {
    clearTimeout(session.duplexPlaybackResetTimer);
    session.duplexPlaybackResetTimer = undefined;
  }
  await resetDuplexListening(session);
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
    ws.send(JSON.stringify({ type: 'transcript_pending' }));
    await service.streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
    const transcript = await service.streamTranscribeChunk(pcm, SAMPLE_RATE, { finalize: true });
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

    // If a tool is awaiting approval, treat this utterance as the permission decision
    // instead of starting a brand-new agent turn.
    if (session.pendingPermission) {
      const intent = parseVoicePermissionIntent(text);
      if (intent) {
        await resolveVoicePermission(ws, session, intent);
      } else {
        await speakSystemLine(session, 'Sorry, I didn\'t catch that. Say allow, always, or deny.');
      }
      if (session.mode === 'duplex') {
        await resetDuplexListening(session);
      } else {
        voiceSession?.setState('idle');
      }
      return;
    }

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
    refreshAgentPersona(agent);
    if (session.clientSituation) {
      agent.setClientSituation(session.clientSituation);
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
      const ev = event as {
        type?: string; content?: string; stage?: string; tool?: string;
        requestId?: string; riskLevel?: string; argsSummary?: string; commandPreview?: string; forAutomation?: boolean;
      };
      if (ev.type === 'stream_chunk' && typeof ev.content === 'string' && ev.content) {
        agentDisplayText = normalizeVoiceAssistantContent(agentDisplayText + ev.content);
        const speakDelta = voiceExtractor.pullSpeakDelta(ev.content);
        if (speakDelta) speakPipeline.feed(speakDelta);
      }
      if (ev.type === 'permission_required' && ev.requestId && !ev.forAutomation) {
        void handleVoicePermissionRequired(ws, session, {
          requestId: ev.requestId,
          tool: ev.tool ?? 'tool',
          riskLevel: ev.riskLevel ?? 'medium',
          argsSummary: ev.argsSummary,
          commandPreview: ev.commandPreview,
        });
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
        // Don't re-enable the mic immediately — wait for the client to confirm
        // TTS playback has finished (via `playback_finished`) to avoid the mic
        // picking up the agent's own voice and creating a response loop.
        scheduleDuplexResume(ws, session);
      }
    };

    const handleVoiceTurnError = (error: unknown) => {
      session.unsub?.();
      session.unsub = undefined;
      session.speaking = false;
      const errMsg = error instanceof Error ? error.message : String(error);
      if (session.mode === 'duplex') {
        // Duplex recovers server-side — surface a transient warning, stay listening,
        // and DON'T fatal-fail the session (which would strand the client on SIGNAL LOST).
        void resetDuplexListening(session);
        const now = Date.now();
        if (now - session.duplexLastErrorAt >= DUPLEX_ERROR_COOLDOWN_MS) {
          session.duplexLastErrorAt = now;
          sendWarning(ws, errMsg);
        }
        voiceSession?.setState('listening');
        notifyDuplexListening(ws);
        return;
      }
      sendError(ws, errMsg);
      voiceSession?.fail(errMsg);
    };

    try {
      const priorAssistant = getLastAssistantInSession(sid);
      const priorContent = priorAssistant?.content ?? '';
      const pendingVoiceSummary = priorAssistant != null
        && isVoiceSummaryOnlyMessage(priorContent);
      // A prior voice-block turn means we're mid voice conversation — use the
      // follow-up phase even if that turn (incorrectly) included a chat body,
      // so short follow-ups aren't treated as brand-new phase-1 queries.
      const priorHasVoiceBlock = priorAssistant != null
        && extractVoiceSpeakable(priorContent).voice.trim().length > 0;
      // "yes please" after the assistant offered the chat report counts as asking for it.
      const wantsChatReport = userWantsVoiceChatReport(text)
        || (isAffirmativeReply(text) && voiceOfferedChatReport(priorContent));

      const turnInstruction = pendingVoiceSummary && wantsChatReport
        ? buildVoiceChatReportPhaseInstruction()
        : priorHasVoiceBlock
          ? buildVoiceFollowUpPhaseInstruction()
          : buildVoiceSummaryPhaseInstruction();

      const chatReportOnly = pendingVoiceSummary && wantsChatReport;
      if (chatReportOnly) {
        session.textOnlyPlayback = true;
      }

      const turnId = randomUUID();
      const turnMessage = await runVoiceAgentPhase(
        agent,
        text,
        turnInstruction,
        turnId,
        sid,
        {
          ...(chatReportOnly && priorAssistant
            ? {
              voiceMergeIntoMessage: {
                messageId: priorAssistant.id,
                prefixContent: priorAssistant.content,
              },
            }
            : {}),
          ...(session.clientSituation ? { clientSituation: session.clientSituation } : {}),
          ...(session.searchWeb ? { forceWebSearch: true } : {}),
        },
      );

      const turnContent = normalizeVoiceAssistantContent(extractAssistantText(turnMessage));
      const { voice, chat: strayChat } = extractVoiceSpeakable(turnContent);

      if (!turnContent.trim()) {
        session.unsub?.();
        session.unsub = undefined;
        ws.send(JSON.stringify({ type: 'agent_status', status: 'complete', empty: true }));
        sendTimings();
        voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
        if (session.mode === 'duplex') {
          await resetDuplexListening(session);
        }
        return;
      }

      if (session.textOnlyPlayback) {
        session.unsub?.();
        session.unsub = undefined;
        agentDisplayText = strayChat || turnContent;
        ws.send(JSON.stringify({
          type: 'agent_status',
          status: 'complete',
          textOnly: true,
          text: agentDisplayText,
        }));
        sendTimings();
        voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
        if (session.mode === 'duplex') {
          await resetDuplexListening(session);
        }
        return;
      }

      const speakText = voice || buildVoiceFallback(strayChat || turnContent);
      if (speakPipeline.streamed || voiceExtractor.closed) {
        await speakPipeline.flush();
      } else {
        await speakPipeline.flush(speakText);
      }

      session.unsub?.();
      session.unsub = undefined;

      const { chat: spokenChat } = extractVoiceSpeakable(turnContent);
      agentDisplayText = spokenChat || voice || '';

      await completeVoiceTurn();
    } catch (phaseError) {
      handleVoiceTurnError(phaseError);
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.includes('fetch failed') || raw.includes('ECONNREFUSED')
      ? 'Voice engine offline — verify setup in Settings → Voice and restart Agent-X'
      : raw;
    const now = Date.now();
    if (session.mode === 'duplex') {
      // Recoverable in hands-free: warn (throttled), reset, keep listening.
      if (now - session.duplexLastErrorAt >= DUPLEX_ERROR_COOLDOWN_MS) {
        session.duplexLastErrorAt = now;
        sendWarning(ws, message);
      }
      voiceSession?.setState('listening');
      await resetDuplexListening(session);
      notifyDuplexListening(ws);
    } else {
      sendError(ws, message);
      voiceSession?.fail(error);
    }
  }
}

function getLastAssistantInSession(sessionId: string): { id: string; content: string } | null {
  try {
    const store = getEngine().sessionManager.getStorageAdapter();
    const msgs = store?.getMessages?.(sessionId) ?? [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const msg = msgs[i];
      if (msg?.role === 'assistant' && typeof msg.content === 'string') {
        const id = msg.id;
        if (typeof id === 'string' && id.length > 0) {
          return { id, content: msg.content };
        }
      }
    }
  } catch { /* best-effort */ }
  return null;
}

function runVoiceAgentPhase(
  agent: NonNullable<ReturnType<typeof getEngine>['agent']>,
  userText: string,
  instruction: string,
  turnId: string,
  sid: string,
  extra: {
    voiceContinuation?: boolean;
    voiceMergeIntoMessage?: { messageId: string; prefixContent: string };
    userMessagePersisted?: boolean;
    clientSituation?: ClientSituation;
    forceWebSearch?: boolean;
  } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    runAgentTurnAsync(
      agent,
      userText,
      instruction,
      false,
      turnId,
      sid,
      (message) => resolve(message),
      (error) => reject(new Error(error)),
      undefined,
      undefined,
      undefined,
      undefined,
      {
        voiceTurn: true,
        // Idle-based: activity (tools/steps/heartbeat) resets this clock so a
        // working hands-free turn isn't aborted mid-tool-run…
        turnTimeoutMs: VOICE_TURN_TIMEOUT_MS,
        fixedTurnTimeout: false,
        // …but a hard ceiling still guarantees the turn can't hang forever.
        maxTurnMs: VOICE_TURN_MAX_MS,
        ...extra,
      },
    );
  });
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
  if (session.pendingPermission) {
    // Deny any dangling prompt so the agent turn isn't left hanging.
    try { getEngine().agent?.respondToPermission(session.pendingPermission.requestId, 'deny'); } catch { /* ignore */ }
    clearPendingPermission(session);
  }
  session.unsub?.();
  if (session.duplexPlaybackResetTimer) clearTimeout(session.duplexPlaybackResetTimer);
  void session.transport.close();
  getVoiceService().closeSession(session.sessionId);
  activeSessions.delete(ws);
  getVoiceService().scheduleIdleUnloadIfIdle();
}

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }));
  }
}

/**
 * Recoverable notice for duplex hands-free: the server has recovered and is
 * still listening. The client should surface a transient hint WITHOUT tearing
 * down the session (unlike `sendError`, which is fatal).
 */
function sendWarning(ws: WebSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'voice_warning', message }));
  }
}

/** Tell the client the duplex session has recovered and is listening again. */
function notifyDuplexListening(ws: WebSocket): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'agent_status', status: 'listening' }));
  }
}

export function countActiveVoiceWebSocketSessions(): number {
  return activeSessions.size;
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
