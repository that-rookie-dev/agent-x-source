import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { VoiceService, WebSocketVoiceTransport, mergeVoiceConfig, getPersonaStore } from '@agentx/engine';
import { XaiRealtimeEngine } from './voice/engines/XaiRealtimeEngine.js';
import type { VoiceEngineSession } from './voice/engines/types.js';
import { VoiceStreamSpeakPipeline, VoiceTurnTimingTracker } from './voice-turn-tts.js';
import {
  VoiceBlockStreamExtractor,
  buildVoiceFallback,
  buildVoiceSummaryPhaseInstruction,
  buildVoiceFollowUpPhaseInstruction,
  buildVoiceChatReportPhaseInstruction,
  buildCrewCallTurnInstruction,
  buildCrewCallOpenerInstruction,
  crewCallSessionHasSpokenHistory,
  extractVoiceSpeakable,
  isVoiceSummaryOnlyMessage,
  userWantsVoiceChatReport,
  isAffirmativeReply,
  voiceOfferedChatReport,
  sanitizeSpeakableText,
  sanitizeVoiceDisplayText,
} from './voice-speakable.js';
import { validateVoiceWebSocketConnection } from './auth.js';
import { ensureSubscribed } from './ws.js';
import { registerWebSocketRoute } from './ws-upgrade-router.js';
import { getEngine, createAgent, destroyAgent, setCurrentClientSituation, hydrateAgentRecentHistory } from './engine.js';
import { runAgentTurnAsync, VOICE_TURN_TIMEOUT_MS, VOICE_TURN_MAX_MS, isCrewPrivateSessionRecord } from './chat-helpers.js';
import { getVoiceService, resetVoiceService } from './voice-runtime.js';
import { parseVoicePermissionIntent, type VoicePermissionIntent } from './voice-permission-intent.js';
import { normalizeClientSituation, getAgentFilesDir, getLogger } from '@agentx/shared';
import type { ProviderId, QuestionnairePayload } from '@agentx/shared';
import { normalizeVoiceAssistantContent } from './voice-speakable.js';
import { refreshAgentPersona } from './chat-helpers.js';
import type { ClientSituation } from '@agentx/shared';
import { updateDuplexEndpointing } from './voice/duplex-endpointing.js';
import { resolveCrewPrivateHostForAgent } from './host-crew-session.js';

const SAMPLE_RATE = 16_000;
/** Minimum interval between streaming STT preview passes (PTT + duplex). */
const STT_PREVIEW_INTERVAL_MS = 200;
/** Continuous silence after spoken words before auto-send in duplex mode. */
export const DUPLEX_END_SILENCE_MS = 2_000;
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
  /** VAD-based: last timestamp (Date.now) when speech was detected. */
  duplexLastSpeechAt: number;
  /** VAD-based: true if the current chunk has speech. */
  duplexVadSpeech: boolean;
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
  /** Crew-call greeting already issued for this WS session (client or server). */
  callKickoffIssued?: boolean;
  /**
   * Serialize sidecar STT calls for this session. Concurrent preview + finalize
   * races corrupt the streaming decoder and return empty transcripts on PTT release.
   */
  sttQueue?: Promise<unknown>;
  /** True while finishTurn owns the mic buffer — skip new STT previews. */
  turnFinishing?: boolean;
}

const activeSessions = new Map<WebSocket, VoiceWsSession>();
const activeEngineSessions = new Map<WebSocket, VoiceEngineSession>();

/** Run STT work strictly one-at-a-time per voice WS session. */
function enqueueSessionStt<T>(session: VoiceWsSession, task: () => Promise<T>): Promise<T> {
  const run = (session.sttQueue ?? Promise.resolve())
    .catch(() => undefined)
    .then(task);
  session.sttQueue = run.then(() => undefined, () => undefined);
  return run;
}

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
  let agentName = 'Agent-X';
  try {
    const persona = getPersonaStore().get();
    if (persona?.name) agentName = persona.name;
  } catch { /* ignore */ }
  return `${agentName} wants to ${action}.${riskNote} Say allow, always, or deny.`;
}

/** Format a choice questionnaire as a spoken prompt for voice interaction. */
function formatQuestionnaireForVoice(payload: QuestionnairePayload): string {
  const lines: string[] = [];
  if (payload.title?.trim()) {
    lines.push(payload.title.trim());
  }
  for (const [i, q] of payload.questions.entries()) {
    if (payload.questions.length > 1) {
      lines.push(`Question ${i + 1}: ${q.prompt}`);
    } else {
      lines.push(q.prompt);
    }
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const opts = (q.options ?? []).filter((o) => !o.disabled);
      opts.forEach((o, j) => {
        lines.push(`${j + 1}: ${o.label ?? o.value}${o.recommended ? ' (suggested)' : ''}`);
      });
      if (q.allowCustom !== false) {
        lines.push(
          q.type === 'multi_choice'
            ? 'Reply with the numbers or names, separated by commas, or say none.'
            : 'Reply with the number or name of your choice.',
        );
      } else {
        lines.push('Reply with the number of your choice.');
      }
    } else {
      lines.push('Reply with your answer.');
    }
  }
  return lines.join('. ').trim();
}

async function handleVoiceClarificationRequired(
  _ws: WebSocket,
  session: VoiceWsSession,
  questionnaire: QuestionnairePayload,
): Promise<void> {
  const line = formatQuestionnaireForVoice(questionnaire);
  await speakSystemLine(session, line);
  // Re-open the mic so the operator can answer hands-free.
  if (session.mode === 'duplex') {
    await resetDuplexListening(session);
  }
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
  session.turnFinishing = false;
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
    // Register handlers BEFORE sending connected — a client that sends
    // session_start on open can otherwise race and drop the first frame.
    ws.on('message', (data, isBinary) => {
      void handleVoiceMessage(ws, data, isBinary);
    });
    ws.on('close', () => {
      cleanupSession(ws);
    });
    ws.send(JSON.stringify({ type: 'connected' }));
  });
}

async function handleVoiceMessage(ws: WebSocket, data: WebSocket.RawData, isBinary: boolean): Promise<void> {
  const session = activeSessions.get(ws);
  const engineSession = activeEngineSessions.get(ws);
  if (isBinary) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (engineSession) {
      engineSession.onBinaryAudio(chunk);
      return;
    }
    if (!session?.recording) return;
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

  if (msg.type === 'call_kickoff') {
    if (engineSession) {
      await engineSession.onClientMessage(msg);
      return;
    }
    if (session) {
      try {
        await runCallKickoff(ws, session, msg.reason === 'resume' ? 'resume' : 'open');
      } catch (err) {
        sendError(ws, err instanceof Error ? err.message : String(err));
      }
    }
    return;
  }

  if (msg.type !== 'session_start' && engineSession) {
    await engineSession.onClientMessage(msg);
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
        session.turnFinishing = false;
        session.recording = true;
        session.recordingStartedAt = Date.now();
        session.audioChunks = [];
        session.duplexSilenceMs = 0;
        session.duplexHadSpeech = false;
        session.duplexHadWords = false;
        session.duplexLastPartial = '';
        session.duplexLastWordAt = Date.now();
        session.duplexTurnInFlight = false;
        session.pttLastSttAt = 0;
        session.pttLastPartial = '';
        session.textOnlyPlayback = false;
        await enqueueSessionStt(session, () =>
          getVoiceService().streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true }),
        );
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
    // Fallbacks required — missing provider/model used to abort creation and then
    // every voice turn hit PG_INSERT_MESSAGE_SKIP (session never entered cache).
    const providerId = ((voiceProvider?.activeProvider as ProviderId) || cfg.provider.activeProvider || 'openai') as ProviderId;
    const modelId = voiceProvider?.activeModel || cfg.provider.activeModel || 'default';
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
    && (!existingAgent.processing || existingAgent.isAwaitingClarification());
  if (keepAgent) return true;

  destroyAgent();
  const session = eng.sessionManager.restoreSession(chatSessionId);
  if (!session) return false;
  createAgent(undefined, session);
  if (eng.agent) {
    // Storage hydration can hang on a busy write queue / PG lock — never block
    // a voice turn forever waiting for history (left clients stuck after STT).
    try {
      await Promise.race([
        hydrateAgentRecentHistory(eng.agent, chatSessionId, 24),
        new Promise<void>((resolve) => setTimeout(resolve, 2_500)),
      ]);
    } catch { /* best-effort */ }
  }
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
  const priorLocal = activeSessions.get(ws);
  if (priorLocal) {
    priorLocal.unsub?.();
    void priorLocal.transport.close();
    getVoiceService().closeSession(priorLocal.sessionId);
    activeSessions.delete(ws);
  }
  const priorEngine = activeEngineSessions.get(ws);
  if (priorEngine) {
    priorEngine.onDisconnect();
    activeEngineSessions.delete(ws);
  }

  const voiceConfig = mergeVoiceConfig(getEngine().configManager.load().voice);
  if (!voiceConfig.enabled) {
    sendError(ws, 'Voice is disabled');
    return;
  }

  // Engine owns the mode: xAI is always duplex; Local is always PTT.
  // Ignore stale client/config duplex leftovers after switching engines.
  const mode = voiceConfig.engine === 'realtime_xai' ? 'duplex' : 'push-to-talk';
  const voiceOnly = Boolean(msg.voiceOnly);
  const chatSessionId = voiceOnly
    ? '__channel__:voice'
    : (typeof msg.chatSessionId === 'string' ? msg.chatSessionId : undefined);
  const voiceWsSessionId = String(msg.sessionId ?? randomUUID());
  const clientSituation = normalizeClientSituation(msg.clientSituation);

  if (voiceConfig.engine === 'realtime_xai') {
    const transport = new WebSocketVoiceTransport({ ws, sessionId: voiceWsSessionId, mode, engine: 'realtime_xai' });
    const engine = new XaiRealtimeEngine();
    try {
      const session = await engine.createSession({
        ws,
        transport,
        sessionId: voiceWsSessionId,
        mode,
        chatSessionId,
        clientSituation,
      });
      activeEngineSessions.set(ws, session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error('VOICE', `xAI realtime session failed: ${message}`);
      sendError(ws, message.includes('API key')
        ? message
        : `xAI voice failed to connect: ${message}`);
    }
    // Greeting is triggered inside XaiRealtimeSession once session.updated fires.
    return;
  }

  const service = getVoiceService();
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

  const voiceSession = service.createSession({ transport: 'web', mode, sessionId: voiceWsSessionId });
  const transport = new WebSocketVoiceTransport({ ws, sessionId: voiceWsSessionId, mode, engine: 'stt_llm_tts' });
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
    duplexLastSpeechAt: 0,
    duplexVadSpeech: false,
    pttLastSttAt: 0,
    pttLastPartial: '',
    transport,
    searchWeb: false,
    bypassChip: false,
    ...(clientSituation ? { clientSituation } : {}),
  });
  voiceSession.setState(mode === 'duplex' ? 'listening' : 'idle');
  ws.send(JSON.stringify({ type: 'session_ready', sessionId: voiceSession.sessionId, mode }));

  // Crew-call greetings are client-driven via `call_kickoff` only.
  // Auto-starting a second opener here raced the client and caused
  // "Session voice:… already has an active run" + stuck orange thinking.
}

async function requestTranscriptPreview(
  ws: WebSocket,
  session: VoiceWsSession,
  options: { throttleKey: 'duplex' | 'ptt' },
): Promise<{ partial: string; wordsNow: string; isSpeech: boolean | null } | null> {
  // Never compete with finalize — that race empties PTT transcripts on release.
  if (!session.recording || session.turnFinishing || session.duplexTurnInFlight) return null;

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
    stream = await enqueueSessionStt(session, async () => {
      // Bail if release/finalize started while we waited on the STT queue.
      if (!session.recording || session.turnFinishing) {
        return { text: '', partial: '', isSpeech: null };
      }
      return service.streamTranscribeChunk(previewPcm, SAMPLE_RATE, { preview: true });
    });
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

  if (!session.recording || session.turnFinishing) return null;

  const partial = stream.partial?.trim() ?? '';
  const wordsNow = partial || stream.text?.trim() || '';
  const isSpeech = stream.isSpeech ?? null;
  return { partial, wordsNow, isSpeech };
}

async function handlePttChunk(ws: WebSocket, session: VoiceWsSession): Promise<void> {
  const preview = await requestTranscriptPreview(ws, session, { throttleKey: 'ptt' });
  if (!preview) return;

  const { partial } = preview;
  if (!partial || partial === session.pttLastPartial) return;
  session.pttLastPartial = partial;
  ws.send(JSON.stringify({ type: 'transcript_partial', text: partial }));
}

async function handleDuplexChunk(ws: WebSocket, session: VoiceWsSession, chunk: Buffer): Promise<void> {
  if (session.duplexTurnInFlight) return;

  if (session.speaking) {
    // Agent is speaking — ignore mic chunks (prevents echo/noise from cutting off TTS).
    return;
  }

  const now = Date.now();
  let isSpeech: boolean | null = null;
  try {
    // Incremental chunk VAD — never the overlapping STT preview window.
    const vad = await getVoiceService().detectVad(chunk, SAMPLE_RATE);
    isSpeech = Boolean(vad.isSpeech);
  } catch {
    isSpeech = null;
  }

  const preview = await requestTranscriptPreview(ws, session, { throttleKey: 'duplex' });
  const wordsNow = preview?.wordsNow ?? '';
  const partial = preview?.partial ?? '';

  const { state, shouldFinish, emitPartial } = updateDuplexEndpointing(
    {
      duplexSilenceMs: session.duplexSilenceMs,
      duplexHadSpeech: session.duplexHadSpeech,
      duplexHadWords: session.duplexHadWords,
      duplexLastPartial: session.duplexLastPartial,
      duplexLastWordAt: session.duplexLastWordAt,
      duplexLastSpeechAt: session.duplexLastSpeechAt,
      duplexVadSpeech: session.duplexVadSpeech,
    },
    {
      now,
      isSpeech,
      wordsNow,
      wordsAvailable: Boolean(preview),
      silenceThresholdMs: DUPLEX_END_SILENCE_MS,
      hasAudio: session.audioChunks.length > 0,
      turnInFlight: session.duplexTurnInFlight,
    },
  );

  session.duplexSilenceMs = state.duplexSilenceMs;
  session.duplexHadSpeech = state.duplexHadSpeech;
  session.duplexHadWords = state.duplexHadWords;
  session.duplexLastPartial = state.duplexLastPartial;
  session.duplexLastWordAt = state.duplexLastWordAt;
  session.duplexLastSpeechAt = state.duplexLastSpeechAt;
  session.duplexVadSpeech = state.duplexVadSpeech;

  ws.send(JSON.stringify({
    type: 'duplex_silence',
    elapsedMs: session.duplexSilenceMs,
    thresholdMs: DUPLEX_END_SILENCE_MS,
  }));

  if (emitPartial && partial) {
    ws.send(JSON.stringify({ type: 'transcript_partial', text: partial }));
  }

  if (shouldFinish) {
    session.recording = false;
    await finishTurn(ws, session);
  }
}

async function resetDuplexListening(session: VoiceWsSession): Promise<void> {
  session.turnFinishing = false;
  session.recording = true;
  session.duplexTurnInFlight = false;
  session.audioChunks = [];
  session.duplexSilenceMs = 0;
  session.duplexHadSpeech = false;
  session.duplexHadWords = false;
  session.duplexLastPartial = '';
  session.duplexLastWordAt = Date.now();
  session.duplexLastSpeechAt = 0;
  session.duplexVadSpeech = false;
  session.pttLastPartial = '';
  session.pttLastSttAt = 0;
  try {
    const service = getVoiceService();
    await enqueueSessionStt(session, () =>
      service.streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true }),
    );
    // Clear Silero LSTM / debounce so the next utterance starts clean.
    await service.detectVad(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
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

function isVoiceAgentBusy(session: VoiceWsSession): boolean {
  if (session.duplexTurnInFlight || session.speaking) return true;
  try {
    const agent = getEngine().agent;
    if (!agent) return false;
    const sid = session.chatSessionId;
    if (sid && agent.sessionId && agent.sessionId !== sid) return false;
    return Boolean(agent.processing) || agent.runStateMgr.isRunning(agent.sessionId);
  } catch {
    return false;
  }
}

async function finishTurn(ws: WebSocket, session: VoiceWsSession): Promise<void> {
  if (session.turnFinishing) return;
  // Kickoff / prior reply still owns the agent — try to clear a stuck lock for PTT
  // so the operator's utterance is not silently discarded after a bad kickoff.
  if (isVoiceAgentBusy(session)) {
    const eng = getEngine();
    const agent = eng.agent;
    const canClearStuck = session.mode === 'push-to-talk'
      && agent
      && !session.duplexTurnInFlight
      && !session.speaking
      && !agent.isAwaitingClarification();
    if (canClearStuck && (agent.processing || agent.runStateMgr.isRunning(agent.sessionId))) {
      getLogger().warn('VOICE', 'Clearing stuck agent before PTT finishTurn');
      try {
        agent.cancel();
        agent.runStateMgr.release(agent.sessionId);
      } catch { /* best-effort */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (isVoiceAgentBusy(session)) {
      getLogger().info('VOICE', 'Ignoring audio_end — agent turn already in flight');
      session.audioChunks = [];
      if (session.mode === 'duplex') {
        // Keep kickoff's duplexTurnInFlight intact; only clear a stray recorder.
        session.recording = false;
        sendWarning(ws, 'Still finishing the last reply — one moment');
      } else {
        sendWarning(ws, 'Still finishing the last reply — try again in a moment');
        ws.send(JSON.stringify({ type: 'agent_status', status: 'complete' }));
      }
      return;
    }
  }
  if (session.mode === 'duplex') {
    session.duplexTurnInFlight = true;
  }
  // Stop live previews immediately so they cannot race finalize on the sidecar.
  session.turnFinishing = true;
  session.recording = false;
  session.textOnlyPlayback = false;
  const service = getVoiceService();
  const voiceSession = service.getSession(session.sessionId);
  voiceSession?.setState('transcribing');

  const pcm = Buffer.concat(session.audioChunks);
  session.audioChunks = [];
  const previewFallback = (
    session.mode === 'push-to-talk' ? session.pttLastPartial : session.duplexLastPartial
  )?.trim() ?? '';

  if (pcm.length === 0) {
    session.turnFinishing = false;
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
    let transcriptText = '';
    try {
      const transcript = await enqueueSessionStt(session, async () => {
        await service.streamTranscribeChunk(Buffer.alloc(0), SAMPLE_RATE, { reset: true });
        return service.streamTranscribeChunk(pcm, SAMPLE_RATE, { finalize: true });
      });
      transcriptText = transcript.text?.trim() ?? '';
    } catch (sttErr) {
      // Streaming STT can fail after a preview race; fall back to one-shot PCM STT.
      getLogger().warn(
        'VOICE',
        `Streaming STT finalize failed — retrying one-shot: ${sttErr instanceof Error ? sttErr.message : String(sttErr)}`,
      );
      const fallback = await service.transcribePcmBuffer(pcm, SAMPLE_RATE);
      transcriptText = fallback.text?.trim() ?? '';
    }
    timings.markSttDone();

    // Prefer finalize text; if empty, keep the live partial the operator already saw.
    const text = transcriptText || previewFallback;
    if (!text) {
      session.turnFinishing = false;
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
    session.turnFinishing = false;

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
      session.duplexTurnInFlight = false;
      sendError(ws, 'No chat session available for voice');
      voiceSession?.setState('idle');
      return;
    }
    const sessionReady = await ensureChatSessionActive(chatSessionId);
    if (!sessionReady) {
      session.duplexTurnInFlight = false;
      sendError(ws, 'Chat session not found');
      voiceSession?.setState('idle');
      return;
    }

    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) {
      session.duplexTurnInFlight = false;
      sendError(ws, 'Agent is not ready');
      voiceSession?.setState('idle');
      return;
    }

    // Re-check after session restore — kickoff / a stuck prior turn may own the agent.
    // Prefer clearing a stuck lock and continuing (we already showed the transcript)
    // over abandoning the turn with no reply.
    if (agent.processing || agent.runStateMgr.isRunning(agent.sessionId)) {
      if (agent.isAwaitingClarification()) {
        // Fall through to clarification handling below.
      } else {
        getLogger().warn('VOICE', 'Agent busy after transcript — cancelling stuck run and continuing');
        try {
          agent.cancel();
          agent.runStateMgr.release(agent.sessionId);
        } catch { /* best-effort */ }
        await new Promise((r) => setTimeout(r, 150));
        if (agent.processing || agent.runStateMgr.isRunning(agent.sessionId)) {
          session.duplexTurnInFlight = false;
          sendWarning(ws, 'Still finishing the last reply — try again in a moment');
          ws.send(JSON.stringify({ type: 'agent_status', status: 'complete' }));
          if (session.mode === 'duplex') {
            await resetDuplexListening(session);
            notifyDuplexListening(ws);
          } else {
            voiceSession?.setState('idle');
          }
          return;
        }
      }
    }

    // Ensure IntegrationHub is not left pointing at an xAI voice toolkit from a
    // prior realtime connect (MCP sync timeout) — local turns need eng.toolkit.
    try {
      eng.integrationHub.setToolkitBridge(eng.toolkit.registry, eng.toolkit.executor);
    } catch { /* best-effort */ }

    // If the agent is waiting for a clarification answer (e.g. automation notify
    // channels), feed this utterance directly to the in-flight turn instead of
    // starting a brand-new one.
    if (agent.isAwaitingClarification() && agent.respondToClarification(text)) {
      ws.send(JSON.stringify({ type: 'clarification_answered', text }));
      // Keep PTT unlocked — the resumed turn continues server-side; operator can speak again.
      voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
      if (session.mode === 'duplex') {
        await resetDuplexListening(session);
      } else {
        ws.send(JSON.stringify({ type: 'agent_status', status: 'complete' }));
      }
      return;
    }

    // Apply the dashboard bypass chip to this agent so tools don't prompt when the user enabled it.
    agent.setBypassPermissions(session.bypassChip);
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
          text: sanitizeVoiceDisplayText(agentDisplayText) || undefined,
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
        questionnaire?: QuestionnairePayload;
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
      if (ev.type === 'clarification_required' && ev.questionnaire) {
        void handleVoiceClarificationRequired(ws, session, ev.questionnaire);
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
        text: sanitizeVoiceDisplayText(agentDisplayText) || undefined,
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
      session.duplexTurnInFlight = false;
      const errMsg = error instanceof Error ? error.message : String(error);
      const softConflict = /already has an active run|already processing/i.test(errMsg);
      if (session.mode === 'duplex' || softConflict) {
        // Duplex / run-overlap: recover without tearing down the call UI.
        void resetDuplexListening(session);
        const now = Date.now();
        if (now - session.duplexLastErrorAt >= DUPLEX_ERROR_COOLDOWN_MS) {
          session.duplexLastErrorAt = now;
          sendWarning(ws, softConflict
            ? 'Still finishing the last reply — try again in a moment'
            : errMsg);
        }
        voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
        if (session.mode === 'duplex') {
          notifyDuplexListening(ws);
        } else {
          ws.send(JSON.stringify({ type: 'agent_status', status: 'complete' }));
        }
        return;
      }
      sendError(ws, errMsg);
      voiceSession?.fail(errMsg);
    };

    try {
      const chatSession = eng.sessionManager.getSessionById(sid);
      const crewCall = isCrewPrivateSessionRecord(chatSession);

      const priorAssistant = getLastAssistantInSession(sid);
      const priorContent = priorAssistant?.content ?? '';
      const pendingVoiceSummary = !crewCall && priorAssistant != null
        && isVoiceSummaryOnlyMessage(priorContent);
      // A prior voice-block turn means we're mid voice conversation — use the
      // follow-up phase even if that turn (incorrectly) included a chat body,
      // so short follow-ups aren't treated as brand-new phase-1 queries.
      const priorHasVoiceBlock = priorAssistant != null
        && extractVoiceSpeakable(priorContent).voice.trim().length > 0;
      // "yes please" after the assistant offered the chat report counts as asking for it.
      const wantsChatReport = !crewCall && (
        userWantsVoiceChatReport(text)
        || (isAffirmativeReply(text) && voiceOfferedChatReport(priorContent))
      );

      const turnInstruction = crewCall
        ? buildCrewCallTurnInstruction()
        : pendingVoiceSummary && wantsChatReport
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
          // Crew calls always get web search (no dashboard toggle required).
          // Dashboard voice still respects the search-web chip.
          ...(crewCall || session.searchWeb ? { forceWebSearch: true } : {}),
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
        agentDisplayText = sanitizeVoiceDisplayText(strayChat || turnContent);
        ws.send(JSON.stringify({
          type: 'agent_status',
          status: 'complete',
          textOnly: true,
          text: agentDisplayText || undefined,
        }));
        sendTimings();
        voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
        if (session.mode === 'duplex') {
          await resetDuplexListening(session);
        }
        return;
      }

      const speakText = sanitizeSpeakableText(voice) || buildVoiceFallback(strayChat || turnContent);
      if (speakPipeline.streamed || voiceExtractor.closed) {
        await speakPipeline.flush();
      } else {
        await speakPipeline.flush(speakText);
      }

      session.unsub?.();
      session.unsub = undefined;

      const { chat: spokenChat } = extractVoiceSpeakable(turnContent);
      agentDisplayText = sanitizeVoiceDisplayText(spokenChat || voice || turnContent);

      await completeVoiceTurn();
    } catch (phaseError) {
      handleVoiceTurnError(phaseError);
    }
  } catch (error) {
    session.turnFinishing = false;
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
    // Prefer in-memory page of recent messages — avoid scanning full session history.
    const msgs = store?.getMessages?.(sessionId);
    if (msgs?.length) {
      for (let i = msgs.length - 1; i >= Math.max(0, msgs.length - 40); i -= 1) {
        const msg = msgs[i];
        if (msg?.role === 'assistant' && typeof msg.content === 'string') {
          const id = msg.id;
          if (typeof id === 'string' && id.length > 0) {
            return { id, content: msg.content };
          }
        }
      }
    }
  } catch { /* best-effort */ }
  return null;
}

/** Crew-call proactive opener / post-hold resume (local STT→LLM→TTS path). */
async function runCallKickoff(
  ws: WebSocket,
  session: VoiceWsSession,
  kind: 'open' | 'resume',
): Promise<void> {
  // Claim locks synchronously before any await — concurrent client+server kickoffs
  // and user audio_end must not start a second Agent run on the same voice session.
  if (session.callKickoffIssued || session.speaking || session.duplexTurnInFlight) return;
  session.callKickoffIssued = true;
  session.duplexTurnInFlight = true;

  const voiceSession = getVoiceService().getSession(session.sessionId);
  try {
    const chatSessionId = await resolveVoiceChatSessionId(session.chatSessionId);
    if (!chatSessionId) {
      sendError(ws, 'No chat session available for call');
      return;
    }
    const sessionReady = await ensureChatSessionActive(chatSessionId);
    if (!sessionReady) {
      sendError(ws, 'Chat session not found');
      return;
    }
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) {
      sendError(ws, 'Agent is not ready');
      return;
    }
    const chatSession = eng.sessionManager.getSessionById(chatSessionId);
    if (!isCrewPrivateSessionRecord(chatSession)) {
      // Still attempt opener if host crew is present (some restores omit contextKind briefly).
      if (!chatSession?.hostCrewId) {
        sendError(ws, 'Not a crew call session');
        return;
      }
    }

    // Resume / reconnect: stay silent and continue the same call (history remains).
    if (kind === 'resume') {
      getLogger().info('VOICE_WS', `Silent call resume — no greeting (${chatSessionId})`);
      return;
    }

    try {
      const store = eng.sessionManager.getStorageAdapter();
      const msgs = store?.getMessages?.(chatSessionId) ?? [];
      if (crewCallSessionHasSpokenHistory(msgs)) {
        getLogger().info('VOICE_WS', `Skipping open greeting — history present (${chatSessionId})`);
        return;
      }
    } catch { /* continue with open greeting */ }

    voiceSession?.setState('agent_running');
    ws.send(JSON.stringify({ type: 'agent_status', status: 'running' }));
    refreshAgentPersona(agent);
    if (session.clientSituation) agent.setClientSituation(session.clientSituation);
    ensureSubscribed();

    const hostCrew = chatSession
      ? resolveCrewPrivateHostForAgent(
        eng.crewManager,
        chatSession,
        eng.sessionManager.getStorageAdapter(),
      )
      : undefined;
    const openerIdentity = hostCrew
      ? { name: hostCrew.name, title: hostCrew.title, expertise: hostCrew.expertise }
      : null;

    const eventText = '[call_event:open]';
    const turnMessage = await runVoiceAgentPhase(
      agent,
      eventText,
      buildCrewCallOpenerInstruction('open', openerIdentity),
      randomUUID(),
      chatSessionId,
      {
        userMessagePersisted: true,
        ...(session.clientSituation ? { clientSituation: session.clientSituation } : {}),
      },
    );
    const content = normalizeVoiceAssistantContent(extractAssistantText(turnMessage));
    const { voice } = extractVoiceSpeakable(content);
    const speakable = sanitizeSpeakableText(voice || buildVoiceFallback(content));
    if (speakable && !session.textOnlyPlayback) {
      session.speaking = true;
      voiceSession?.setState('speaking');
      ws.send(JSON.stringify({
        type: 'agent_status',
        status: 'speaking',
        text: sanitizeVoiceDisplayText(speakable) || undefined,
      }));
      await speakSystemLine(session, speakable);
    }
    ws.send(JSON.stringify({
      type: 'agent_status',
      status: 'complete',
      text: sanitizeVoiceDisplayText(speakable) || undefined,
    }));
    ws.send(JSON.stringify({ type: 'audio_end' }));
    voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Overlap / stuck-run races are recoverable — don't kill the call UI.
    if (/already has an active run|already processing/i.test(errMsg)) {
      sendWarning(ws, 'Welcome delayed — you can start speaking');
    } else {
      sendError(ws, errMsg);
    }
    voiceSession?.setState(session.mode === 'duplex' ? 'listening' : 'idle');
  } finally {
    session.speaking = false;
    session.duplexTurnInFlight = false;
    if (session.mode === 'duplex') {
      await resetDuplexListening(session);
      notifyDuplexListening(ws);
    } else {
      ws.send(JSON.stringify({ type: 'agent_status', status: 'complete' }));
    }
  }
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
  const start = (retried: boolean) => new Promise<unknown>((resolve, reject) => {
    runAgentTurnAsync(
      agent,
      userText,
      instruction,
      false,
      retried ? randomUUID() : turnId,
      sid,
      (message) => resolve(message),
      (error) => {
        if (!retried && /already has an active run|already processing/i.test(error)) {
          getLogger().warn('VOICE', `Clearing stuck agent run and retrying once: ${error}`);
          try {
            agent.cancel();
            agent.runStateMgr.release(agent.sessionId);
          } catch { /* best-effort */ }
          setTimeout(() => {
            void start(true).then(resolve, reject);
          }, 150);
          return;
        }
        reject(new Error(error));
      },
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
  return start(false);
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
  const engineSession = activeEngineSessions.get(ws);
  if (engineSession) {
    engineSession.onDisconnect();
    activeEngineSessions.delete(ws);
  }
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
  return activeSessions.size + activeEngineSessions.size;
}

export async function shutdownVoiceWebSocket(): Promise<void> {
  for (const ws of activeSessions.keys()) {
    ws.close();
  }
  for (const [ws, session] of activeEngineSessions.entries()) {
    session.onDisconnect();
    try { ws.close(); } catch { /* ignore */ }
  }
  activeSessions.clear();
  activeEngineSessions.clear();
  try {
    await getVoiceService().stop();
  } catch { /* sidecar may never have started */ }
  resetVoiceService();
  voiceWss?.close();
  voiceWss = undefined;
}

export { extractAssistantText };
