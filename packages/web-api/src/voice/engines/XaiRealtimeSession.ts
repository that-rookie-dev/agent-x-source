import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type {
  AgentXConfig,
  ClientSituation,
  MessageMetadata,
  PermissionHandlerResult,
  StorableSession,
  ToolResult,
  VoiceConfig,
  VoiceSessionMode,
} from '@agentx/shared';
import {
  getAgentFilesDir,
  getLogger,
  isCrewVoiceSessionId,
  buildListDayDivider,
  takeCallDividerForPersist,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
  XAI_BARGE_IN_PLAYBACK_GRACE_MS,
  XAI_SERVER_VAD,
  XAI_WAKE_SERVER_VAD,
  VOICE_USER_TRANSCRIPT_DEDUP_MS,
} from '@agentx/shared';
import { VoicePermissionGate } from '../../voice-permission-gate.js';
import {
  WebSocketVoiceTransport,
  ToolService,
  summarizePermissionArgs,
  buildCrewPrivateIdentityPrompt,
  getPersonaStore,
  setCustomCrewCreateAgent,
  applyInstructedActionConsent,
} from '@agentx/engine';
import type { VoiceEngineSession, VoiceEngineState } from './types.js';
import type { VoiceSessionSpeaker } from '@agentx/engine';
import { getVoiceService } from '../../voice-runtime.js';
import { getEngine } from '../../engine.js';
import { persistMessageDirect } from '../../ws.js';
import { buildAgentInstruction, isCrewPrivateSessionRecord } from '../../chat-helpers.js';
import { resolveCrewPrivateHostForAgent } from '../../host-crew-session.js';
import {
  buildCrewCallRealtimeOpenerInstruction,
  XAI_VOICE_STAGE_AND_CREW_RULES,
} from '../../voice-speakable.js';
import { restorePrimaryToolkitBridge, syncIntegrationToolsIntoToolkit } from '../sync-integration-tools.js';
import {
  WAKE_WORD_IDLE_MS,
  isInWakeIdle,
  tryStripWakePhrase,
  normalizeWakePhrase,
  pickWakeAck,
} from '../wake-phrase.js';
import {
  idleMsSince,
  resolveVoiceIdleBand,
  XAI_RESUME_IDLE_MS,
  type VoiceIdleBand,
} from '../voice-realtime-policy.js';
import {
  loadVoiceRealtimeState,
  peekVoiceRealtimeStateFromFile,
  persistXaiConversationId,
  touchVoiceRealtimeActive,
} from '../voice-realtime-store.js';
import { seedCallDividerClockFromStore } from '../seed-call-divider-clock.js';
import {
  buildColdSummaryText,
  buildWarmReminderText,
  ensureVoiceSessionSummary,
  loadRecentVoiceDelta,
  loadVoiceSessionMessages,
} from '../VoiceSessionSummaryService.js';

const XAI_REALTIME_URL = 'wss://api.x.ai/v1/realtime';
const VOICE_SAMPLE_RATE = VOICE_INPUT_SAMPLE_RATE;
const OUTPUT_SAMPLE_RATE = VOICE_OUTPUT_SAMPLE_RATE;

interface ToolCallItem {
  call_id: string;
  name: string;
  args: Record<string, unknown>;
  result?: ToolResult;
}

export class XaiRealtimeSession implements VoiceEngineSession {
  readonly sessionId: string;
  chatSessionId?: string;
  readonly mode: VoiceSessionMode;

  private state: VoiceEngineState = 'idle';
  private systemAnnounce = false;
  private transport: WebSocketVoiceTransport;
  private xaiWs?: WebSocket;
  private xaiPingTimer?: ReturnType<typeof setInterval>;
  private config: AgentXConfig;
  private voiceConfig: VoiceConfig;
  private toolService: ToolService;
  private permissionGate = new VoicePermissionGate({
    speak: (line) => this.speakSystemLine(line),
    agentName: () => this.getPersona()?.name?.trim() || 'Agent-X',
  });
  private toolCalls: ToolCallItem[] = [];
  private pendingToolCallIndex = 0;
  private toolCallProcessing = false;
  private responseDoneReceived = false;
  private responseAudioDone = false;
  private playbackFinished = false;
  private responseFinished = false;
  private currentResponseId?: string;
  /** Wall clock when assistant audio first started — used to ignore early false barge-ins. */
  private speakingStartedAt = 0;
  private assistantText = '';
  private lastAssistantUtterance = '';
  private lastUserUtterance = '';
  private userTranscript = '';
  /** Dedup xAI transcription.completed (same item / same text within a short window). */
  private handledTranscriptItemIds = new Set<string>();
  private lastEmittedUserTranscript = '';
  private lastEmittedUserTranscriptAt = 0;
  private transcriptCompletedChain: Promise<void> = Promise.resolve();
  private searchWeb = true;
  /** Connected MCP / integration provider names last synced into this voice toolkit. */
  private connectedIntegrationNames: string[] = [];
  /** Greeting kickoff queued before xAI session.updated, or requested by client. */
  private pendingKickoff: 'open' | 'resume' | null = null;
  private kickoffIssued = false;
  /** Open greeting response in flight — UI should show purple speaking, not orange thinking. */
  private greetingInFlight = false;
  /** True when prior voice context exists (resume / remind / summary) — skip open greeting. */
  private hasSeededSpokenHistory = false;
  private closed = false;
  private ready = false;
  private xaiUrl: string;
  /** Stable xAI conversation id for this Agent-X voice session (never rotated). */
  private persistedConversationId: string | null = null;
  private lastVoiceActiveAt: string | null = null;
  private idleBand: VoiceIdleBand = 'fresh';
  /** One-shot fallback if xAI rejects a resumed conversation_id query param. */
  private resumeIdOmitRetryUsed = false;
  /** Ignore teardown events from a socket we intentionally replaced. */
  private suppressXaiSocketTeardown = false;
  /** Monotonic connect id — stale sockets from retries must not flip ready/error. */
  private connectGeneration = 0;
  private sessionUpdateSent = false;
  private forceReadyTimer: ReturnType<typeof setTimeout> | undefined;
  private responseDoneFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  private playbackContinueTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly READY_FALLBACK_MS = 5_000;
  private readonly START_TIMEOUT_MS = 60_000;
  /** Match client playback grace — ignore server VAD barge-in during initial TTS. */
  private readonly BARGE_IN_GRACE_MS = XAI_BARGE_IN_PLAYBACK_GRACE_MS;
  private apiKey: string;
  private model: string;
  private voice: string;
  private wakeWordEnabled: boolean;
  private wakePhrase: string;
  private wakeIdleUntil: number;
  private clientSituation?: ClientSituation | null;
  private realtimeAudioChunks: Buffer[] = [];
  private realtimeRecording = false;
  private currentSpeaker: VoiceSessionSpeaker | null = null;
  private pendingSpeakerPromise: Promise<void> | null = null;
  private voiceprintEnabled = false;
  private readonly defaultRootSpeaker: VoiceSessionSpeaker;

  constructor(options: {
    ws: WebSocket;
    transport: WebSocketVoiceTransport;
    sessionId: string;
    mode: VoiceSessionMode;
    chatSessionId?: string;
    clientSituation?: ClientSituation | null;
    config: AgentXConfig;
    voiceConfig: VoiceConfig;
    apiKey: string;
    wakeWord?: boolean;
    wakePhrase?: string;
  }) {
    this.sessionId = options.sessionId;
    this.chatSessionId = options.chatSessionId;
    this.mode = options.mode;
    this.transport = options.transport;
    this.clientSituation = options.clientSituation;
    this.config = options.config;
    this.voiceConfig = options.voiceConfig;
    this.apiKey = options.apiKey;
    this.model = this.voiceConfig.xai?.model ?? 'grok-voice-latest';
    this.voice = this.voiceConfig.xai?.voice ?? 'eve';
    this.wakeWordEnabled = Boolean(options.wakeWord);
    this.wakePhrase = normalizeWakePhrase(typeof options.wakePhrase === 'string' ? options.wakePhrase : '');
    this.wakeIdleUntil = 0;
    const baseUrl = this.voiceConfig.xai?.baseUrl ?? XAI_REALTIME_URL;
    const baseWithQuery = baseUrl.includes('?') ? baseUrl : `${baseUrl}?model=${encodeURIComponent(this.model)}`;
    this.xaiUrl = baseWithQuery;
    const scopePath = getAgentFilesDir();
    this.toolService = ToolService.createDefault(scopePath);
    const voiceExecutor = this.toolService.getToolExecutor();
    voiceExecutor.setVoiceTurnActive(true);
    voiceExecutor.setCurrentUserMessageProvider(() => this.lastUserUtterance);
    try {
      const mainExec = getEngine().agent?.getToolExecutor();
      if (mainExec) {
        voiceExecutor.setUserConfigRules(mainExec.getUserConfigRules());
        voiceExecutor.setAlwaysPromptPermissions(mainExec.getAlwaysPromptPermissions());
      }
    } catch { /* engine may still be booting */ }
    this.bindLiveCrewAgent();
    const callsign = this.config.user?.callsign?.trim() || 'Root';
    this.defaultRootSpeaker = {
      id: null,
      name: callsign,
      isRoot: true,
      recognized: true,
      confidence: null,
    };
    this.setupPermissionHandler();
  }

  getState(): VoiceEngineState {
    return this.state;
  }

  async start(): Promise<void> {
    getLogger().info('XAI_VOICE', 'Starting xAI realtime session…');
    // Session row must exist in the PG cache BEFORE any transcript persist.
    this.ensureChatSessionRecord();
    // xAI conversation_id from the local file mirror — do not wait on hydrate or PG.
    const peeked = peekVoiceRealtimeStateFromFile(this.voiceSessionKey());
    if (peeked) {
      this.persistedConversationId = peeked.xaiConversationId?.trim() || null;
      this.lastVoiceActiveAt = peeked.lastVoiceActiveAt ?? null;
      const idle = idleMsSince(this.lastVoiceActiveAt);
      this.idleBand = resolveVoiceIdleBand(idle);
    }
    void this.hydrateChatSessionMessages().catch((err) => {
      getLogger().warn(
        'XAI_VOICE',
        `hydrateChatSessionMessages failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    void this.loadRealtimeIdentity().catch(() => undefined);
    this.connect();
    // Wait until the xAI session is configured before returning.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const wsState = this.xaiWs?.readyState;
        reject(
          new Error(
            `xAI realtime session timed out after ${this.START_TIMEOUT_MS / 1000}s`
              + ` (wsState=${wsState ?? 'none'}, updateSent=${this.sessionUpdateSent})`,
          ),
        );
      }, this.START_TIMEOUT_MS);
      const check = () => {
        if (this.ready) {
          clearTimeout(timeout);
          if (this.forceReadyTimer) clearTimeout(this.forceReadyTimer);
          resolve();
        } else if (this.state === 'error') {
          clearTimeout(timeout);
          reject(new Error('xAI realtime session failed'));
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  private voiceSessionKey(): string {
    return this.chatSessionId ?? '__channel__:voice';
  }

  /** Load durable conversation id + idle band before opening the xAI socket. */
  private async loadRealtimeIdentity(): Promise<void> {
    const key = this.voiceSessionKey();
    try {
      const state = await Promise.race([
        loadVoiceRealtimeState(key),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_500)),
      ]);
      this.persistedConversationId = state?.xaiConversationId?.trim() || null;
      this.lastVoiceActiveAt = state?.lastVoiceActiveAt ?? null;
      const idle = idleMsSince(this.lastVoiceActiveAt);
      this.idleBand = resolveVoiceIdleBand(idle);
      getLogger().info(
        'XAI_VOICE',
        `Realtime identity for ${key}: conversation=${this.persistedConversationId ?? 'none'} idleBand=${this.idleBand}`
          + (idle != null ? ` idleMs=${idle}` : ''),
      );
    } catch (err) {
      getLogger().warn(
        'XAI_VOICE',
        `Failed to load voice realtime state: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.idleBand = 'fresh';
    }
  }

  private markVoiceActive(): void {
    const key = this.voiceSessionKey();
    const at = new Date().toISOString();
    this.lastVoiceActiveAt = at;
    void touchVoiceRealtimeActive(key, at).catch(() => { /* best-effort */ });
  }

  private isConversationResumeError(message: string): boolean {
    // Do NOT match our own synthetic close reason — only real xAI/API errors.
    return /conversation not found|unknown conversation|invalid conversation|no such conversation|conversation_id (?:is )?(?:invalid|unknown|not found)|resumption (?:failed|rejected|invalid)/i.test(
      message,
    );
  }

  /** xAI may reject ?conversation_id= with HTTP 400 — retry once without the query param. */
  private isConversationIdHandshakeError(message: string): boolean {
    if (!this.persistedConversationId) return false;
    return /unexpected server response:\s*400/i.test(message)
      || this.isConversationResumeError(message);
  }

  /** Keep durable id; retry once without ?conversation_id= if xAI rejects the resume param. */
  private maybeRetryConnectWithoutConversationId(reason: string): boolean {
    if (this.resumeIdOmitRetryUsed || !this.persistedConversationId || this.closed) return false;
    if (!this.isConversationIdHandshakeError(reason)) return false;
    this.resumeIdOmitRetryUsed = true;
    this.suppressXaiSocketTeardown = true;
    getLogger().warn(
      'XAI_VOICE',
      `Retrying xAI connect without conversation_id query (keeping durable id ${this.persistedConversationId}): ${reason}`,
    );
    this.ready = false;
    this.disconnectXai();
    this.connect({ omitConversationId: true });
    return true;
  }

  onBinaryAudio(pcm: Buffer): void {
    if (this.closed || !this.xaiWs || this.xaiWs.readyState !== WebSocket.OPEN) return;
    if (this.systemAnnounce) return;
    this.xaiWs.send(pcm);
    if (this.realtimeRecording) {
      this.realtimeAudioChunks.push(pcm);
    }
  }

  async onClientMessage(msg: Record<string, unknown>): Promise<void> {
    const type = String(msg.type ?? '');
    switch (type) {
      case 'audio_start':
        await this.handleAudioStart();
        break;
      case 'audio_end':
        await this.handleAudioEnd();
        break;
      case 'playback_finished':
        await this.handlePlaybackFinished();
        break;
      case 'playback_interrupted':
        await this.handlePlaybackInterrupted();
        break;
      case 'permission_response':
        this.handlePermissionResponse(msg);
        break;
      case 'voice_toggle':
        this.handleVoiceToggle(msg);
        break;
      case 'client_situation':
        this.handleClientSituation(msg);
        break;
      case 'call_kickoff':
        this.handleCallKickoff(msg.reason === 'resume' ? 'resume' : 'open');
        break;
      case 'session_end':
        this.onDisconnect();
        break;
      default:
        // Ignore unknown control frames.
        break;
    }
  }

  onDisconnect(): void {
    if (this.closed) return;
    this.closed = true;
    this.toolService.getToolExecutor().setVoiceTurnActive(false);
    this.setState('idle');
    this.permissionGate.dispose();
    this.disconnectXai();
    void this.transport.close().catch(() => { /* ignore */ });
  }

  private setState(state: VoiceEngineState): void {
    this.state = state;
  }

  private connect(options?: { omitConversationId?: boolean }): void {
    const generation = ++this.connectGeneration;
    this.sessionUpdateSent = false;
    if (this.forceReadyTimer) {
      clearTimeout(this.forceReadyTimer);
      this.forceReadyTimer = undefined;
    }
    try {
      let url = this.xaiUrl;
      if (this.persistedConversationId && !options?.omitConversationId) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}conversation_id=${encodeURIComponent(this.persistedConversationId)}`;
      }
      getLogger().info(
        'XAI_VOICE',
        `Connecting to xAI realtime: ${url.replace(/conversation_id=[^&]+/, 'conversation_id=…')}`,
      );
      const ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      this.xaiWs = ws;

      ws.on('open', () => {
        if (generation !== this.connectGeneration) return;
        this.suppressXaiSocketTeardown = false;
        getLogger().info('XAI_VOICE', 'xAI realtime WebSocket open');
        // Keepalive: ping xAI every 20s to prevent idle-timeout disconnects
        // during long responses with brief audio gaps (thinking between sentences).
        this.xaiPingTimer = setInterval(() => {
          if (this.xaiWs !== ws || this.xaiWs.readyState !== WebSocket.OPEN) return;
          try { this.xaiWs.ping(); } catch { /* ignore */ }
        }, 20_000);
        void this.refreshToolsAndSessionUpdate().catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (this.maybeRetryConnectWithoutConversationId(message)) return;
          getLogger().error('XAI_VOICE', `session.update failed: ${message}`);
          this.sendError(`xAI session update failed: ${message}`);
          this.setState('error');
          this.disconnectXai();
        });
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (generation !== this.connectGeneration) return;
        if (!isBinary) {
          const text = Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
          try {
            const event = JSON.parse(text) as Record<string, unknown>;
            void this.handleXaiEvent(event).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              getLogger().error('XAI_VOICE', `Event handler error: ${message}`);
              this.sendError(`xAI event error: ${message}`);
              this.setState('error');
            });
          } catch {
            getLogger().warn('XAI_VOICE', 'Ignored non-JSON xAI message');
          }
        } else {
          this.handleXaiAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        }
      });

      ws.on('error', (err: Error) => {
        if (generation !== this.connectGeneration) return;
        if (this.suppressXaiSocketTeardown || this.xaiWs !== ws) return;
        if (this.maybeRetryConnectWithoutConversationId(err.message)) return;
        getLogger().error('XAI_VOICE', `xAI connection error: ${err.message}`);
        this.sendError(`xAI connection error: ${err.message}`);
        this.setState('error');
        this.disconnectXai();
      });

      ws.on('close', () => {
        if (generation !== this.connectGeneration) return;
        if (this.suppressXaiSocketTeardown || this.xaiWs !== ws) return;
        if (!this.closed && !this.ready) {
          getLogger().warn('XAI_VOICE', 'xAI realtime WebSocket closed during handshake');
          this.sendError('xAI connection closed');
          this.setState('error');
        } else if (!this.closed) {
          getLogger().warn('XAI_VOICE', 'xAI realtime WebSocket closed unexpectedly');
          this.sendError('xAI connection closed');
          this.setState('error');
        }
        if (this.xaiWs === ws) this.disconnectXai();
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error('XAI_VOICE', `xAI realtime constructor error: ${message}`);
      this.sendError(`Failed to connect to xAI realtime: ${message}`);
      this.setState('error');
    }
  }

  private disconnectXai(): void {
    if (this.forceReadyTimer) {
      clearTimeout(this.forceReadyTimer);
      this.forceReadyTimer = undefined;
    }
    if (this.responseDoneFallbackTimer) {
      clearTimeout(this.responseDoneFallbackTimer);
      this.responseDoneFallbackTimer = undefined;
    }
    this.clearPlaybackContinueTimer();
    if (this.xaiPingTimer) {
      clearInterval(this.xaiPingTimer);
      this.xaiPingTimer = undefined;
    }
    if (this.xaiWs) {
      try { this.xaiWs.terminate(); } catch { /* ignore */ }
      this.xaiWs = undefined;
    }
  }

  /**
   * Push session.update IMMEDIATELY so xAI can emit session.updated / we can
   * send session_ready. MCP sync is slow (per-connection await) and must not
   * gate the voice uplink — that left the UI stuck on "Connecting…".
   */
  private async refreshToolsAndSessionUpdate(): Promise<void> {
    // 1) Base toolkit tools immediately — MCP sync follows on a second update.
    this.sendSessionUpdate({ includeResumption: false, includeTools: true });

    // 2) Best-effort tool sync with a hard timeout, then refresh tools + resumption.
    try {
      const syncPromise = syncIntegrationToolsIntoToolkit(
        this.toolService.getRegistry(),
        this.toolService.getToolExecutor(),
      );
      const timedOut = await Promise.race([
        syncPromise.then((sync) => ({ sync, timedOut: false as const })),
        new Promise<{ sync: null; timedOut: true }>((resolve) => {
          setTimeout(() => resolve({ sync: null, timedOut: true }), 8_000);
        }),
      ]);
      if (timedOut.timedOut) {
        getLogger().warn('XAI_VOICE', 'Integration tool sync timed out (8s) — continuing with base tools');
        // prepareForAgentTurn may still hold the toolkit bridge — restore now so
        // local voice / chat keep working while sync finishes in the background.
        restorePrimaryToolkitBridge();
        void syncPromise.catch(() => undefined);
        if (!this.closed && this.xaiWs?.readyState === WebSocket.OPEN) {
          this.sendSessionUpdate({ includeResumption: true });
        }
        return;
      }
      if (timedOut.sync) {
        this.connectedIntegrationNames = timedOut.sync.connectedNames;
        getLogger().info(
          'XAI_VOICE',
          `Tool sync: ${timedOut.sync.registeredCount} MCP tool(s)`
            + (timedOut.sync.connectedNames.length ? ` from ${timedOut.sync.connectedNames.join(', ')}` : ' (no MCP connections)'),
        );
      }
      if (!this.closed && this.xaiWs?.readyState === WebSocket.OPEN) {
        this.sendSessionUpdate({ includeResumption: true });
      }
    } catch (err) {
      getLogger().warn(
        'XAI_VOICE',
        `Integration tool sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!this.closed && this.xaiWs?.readyState === WebSocket.OPEN) {
        this.sendSessionUpdate({ includeResumption: true });
      }
    }
  }

  private sendSessionUpdate(options?: { includeResumption?: boolean; includeTools?: boolean }): void {
    const registry = this.toolService.getRegistry();
    // Strip UI-only meta tools; keep memory/KB/search helpers voice turns need.
    const VOICE_AI_META_ALLOW = new Set([
      'knowledge_base_search',
      'cortex_memory_search',
      'memory_recall',
      'memory_read',
      'memory_store',
      'codebase_search',
    ]);
    const toolList = registry.list().filter((t) => {
      if (t.category === 'agent_meta') return false;
      if (t.category === 'ai_meta') return VOICE_AI_META_ALLOW.has(t.id);
      return true;
    });
    const tools = options?.includeTools === false ? undefined : registry.toSchemas(toolList);
    // VAD: shared with dashboard + call clients (see voice-duplex-params).
    // Client forwards frames above XAI_BARGE_IN_MIC_LEVEL and triggers local
    // barge-in above XAI_BARGE_IN_TRIGGER_LEVEL after playback grace.
    // interrupt_response / create_response are OpenAI-only — xAI rejects unknown
    // turn_detection fields and may never emit session.updated.
    const turnDetection = this.mode === 'duplex'
      ? {
          type: 'server_vad',
          ...(this.wakeWordEnabled ? XAI_WAKE_SERVER_VAD : XAI_SERVER_VAD),
        }
      : { type: null };

    const sessionBody: Record<string, unknown> = {
      instructions: this.buildInstructions(),
      voice: this.voice,
      turn_detection: turnDetection,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: VOICE_SAMPLE_RATE },
          transport: 'binary',
          // NOTE: xAI does NOT support transcription.model (only language_hint
          // and keyterms). Sending an unsupported field can cause the entire
          // session.update to fail silently, making xAI fall back to default
          // VAD settings (threshold 0.85) which cuts off speech aggressively.
          // xAI sends transcription events automatically — no config needed.
        },
        output: {
          format: { type: 'audio/pcm', rate: OUTPUT_SAMPLE_RATE },
          transport: 'binary',
        },
      },
    };
    if (tools) {
      sessionBody.tools = tools;
    }
    // Opt into conversation resumption so the durable conversation_id keeps history.
    if (options?.includeResumption !== false) {
      sessionBody.resumption = { enabled: true };
    }

    const payload = {
      type: 'session.update',
      session: sessionBody,
    };
    getLogger().info('XAI_VOICE', `session.update sending turn_detection: ${JSON.stringify(turnDetection)}`);
    this.sessionUpdateSent = true;
    this.sendXai(payload);
    this.scheduleReadyFallback();
  }

  private scheduleReadyFallback(): void {
    if (this.forceReadyTimer) clearTimeout(this.forceReadyTimer);
    this.forceReadyTimer = setTimeout(() => {
      if (this.closed || this.ready) return;
      if (this.xaiWs?.readyState !== WebSocket.OPEN) return;
      getLogger().warn(
        'XAI_VOICE',
        'session.updated not received after session.update — marking ready (degraded handshake)',
      );
      void this.handleSessionUpdated();
    }, this.READY_FALLBACK_MS);
  }

  private buildInstructions(): string {
    const crewHost = this.resolveCrewCallHost();
    const parts: string[] = [];
    if (crewHost) {
      parts.push(buildCrewPrivateIdentityPrompt(crewHost));
      parts.push(
        'PHONE CALL MODE: You are on a live phone call as yourself — not Agent-X. ' +
        'Speak in short natural turns (1–3 sentences). No markdown, skill menus, or generic assistant clichés. ' +
        'Use prior conversation history for continuity across holds and later calls.',
      );
      parts.push(
        'CLARIFICATION: Ask one spoken question at a time. Never use forms or questionnaires.',
      );
      parts.push(
        'RESEARCH: You have web search and other tools available on this call. ' +
        'Use them when the conversation needs current facts, research, or live information — ' +
        'then answer briefly in character.',
      );
      parts.push(XAI_VOICE_STAGE_AND_CREW_RULES);
      if (this.connectedIntegrationNames.length > 0) {
        parts.push(
          `CONNECTED INTEGRATIONS (MCP): ${this.connectedIntegrationNames.join(', ')}. ` +
          'Use the matching integration__* tools for those services when the user asks. ' +
          'Do not claim you lack access when an integration is listed here.',
        );
      }
    } else {
      const persona = this.getPersona();
      if (persona) {
        const description = [persona.name, persona.description].filter(Boolean).join(' — ');
        if (description) parts.push(`You are ${description}.`);
        if (persona.communicationStyle) parts.push(`Communication style: ${persona.communicationStyle}`);
        if (persona.decisionMaking) parts.push(`Decision making: ${persona.decisionMaking}`);
        if (persona.domainContext) parts.push(`Domain context: ${persona.domainContext}`);
        if (persona.traits?.length) parts.push(`Traits: ${persona.traits.join(', ')}`);
      }
      parts.push(buildAgentInstruction());
      parts.push(XAI_VOICE_STAGE_AND_CREW_RULES);
      parts.push(
        'VOICE MODE RULES: Keep responses short and crisp — ideally 1-3 sentences. ' +
        'Answer the question directly, then stop. Do not elaborate, summarize, or ' +
        'repeat unless the user explicitly asks for more detail. ' +
        'Ask crisp follow-up questions only when needed to move the conversation forward. ' +
        'Never read back what the user just said. Never preface answers with "Sure", "Great", etc. ' +
        'Never spell a full web URL — say the site name and what the file is.',
      );
      parts.push(
        'ACTION EXECUTION: You can run Agent-X tools on this call (save_to_article, article_list, ' +
        'web_search, file_write, integrations, and the rest of the toolkit). ' +
        'When the user asks you to do something, call the matching tool in that same turn. ' +
        'If they already said yes / please / save it / go ahead / do not ask again, call the tool immediately. ' +
        'Never re-ask for confirmation after they have agreed. ' +
        'Never claim you saved, sent, or completed an action unless the tool returned success.',
      );
      parts.push(
        'CLARIFICATION RULES: When you need more information, ask the question directly ' +
        'in your voice response — one question at a time. Wait for the user to answer ' +
        'before asking the next question. Never present multiple questions at once. ' +
        'Never use forms, questionnaires, or structured input — this is a voice conversation.',
      );
      parts.push(
        'TURN JOURNEY (silent): memory → knowledge base → web search → model knowledge. ' +
        'Use web_search when memory and KB are insufficient or facts may be stale.',
      );
      if (this.connectedIntegrationNames.length > 0) {
        parts.push(
          `CONNECTED INTEGRATIONS (MCP): ${this.connectedIntegrationNames.join(', ')}. ` +
          'Use the matching integration__* tools for those services when the user asks. ' +
          'Do not claim you lack access when an integration is listed here.',
        );
      }
    }
    if (this.clientSituation) {
      const situationParts: string[] = [];
      if (this.clientSituation.clientNow) {
        situationParts.push(`The user's current local time is ${this.clientSituation.clientNow}`);
      }
      if (this.clientSituation.timezone) {
        situationParts.push(`Timezone: ${this.clientSituation.timezone}`);
      }
      if (this.clientSituation.locationLabel) {
        situationParts.push(`Location: ${this.clientSituation.locationLabel}`);
      }
      if (this.clientSituation.vpnSuspected) {
        situationParts.push('Note: VPN/proxy usage is suspected; location may be unreliable.');
      }
      if (situationParts.length > 0) {
        parts.push(`Current context:\n${situationParts.join('\n')}`);
      }
    }
    const effectiveSpeaker = this.currentSpeaker ?? (this.voiceprintEnabled ? null : this.defaultRootSpeaker);
    if (effectiveSpeaker) {
      if (effectiveSpeaker.isRoot) {
        const callsign = effectiveSpeaker.name ?? 'Root';
        parts.push(`Current speaker: ${callsign} (root). This is the primary owner. Address them by their callsign "${callsign}" whenever you would address them.`);
      } else if (effectiveSpeaker.recognized) {
        const name = effectiveSpeaker.name ?? 'friend';
        parts.push(`Current speaker: ${name} (friend). You know this person. Address them by their name "${name}" when it is natural to do so.`);
      } else {
        parts.push(`Current speaker: anonymous (stranger). You do not know this person. Be polite and respond as you would to a stranger. Do not use any saved personal context.`);
      }
    }
    return parts.filter(Boolean).join('\n\n');
  }

  private resolveCrewCallHost() {
    try {
      const id = this.chatSessionId;
      if (!id || id === '__channel__:voice') return null;
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(id);
      if (!isCrewPrivateSessionRecord(session) || !session?.hostCrewId) return null;
      const store = eng.sessionManager.getStorageAdapter();
      return resolveCrewPrivateHostForAgent(eng.crewManager, session, store) ?? null;
    } catch {
      return null;
    }
  }

  private isCrewCallSession(): boolean {
    const id = this.chatSessionId;
    if (!id || id === '__channel__:voice') return false;
    if (isCrewVoiceSessionId(id)) return true;
    try {
      const session = getEngine().sessionManager.getSessionById(id);
      return Boolean(isCrewPrivateSessionRecord(session) && session?.hostCrewId);
    } catch {
      return false;
    }
  }

  private handleCallKickoff(kind: 'open' | 'resume'): void {
    // Always record the latest requested kind (resume supersedes open).
    this.pendingKickoff = kind;
    if (!this.ready || this.closed || !this.xaiWs || this.xaiWs.readyState !== WebSocket.OPEN) {
      getLogger().info('XAI_VOICE', `Queued call_kickoff (${kind}) until session is ready`);
      return;
    }
    this.flushPendingKickoff();
  }

  private flushPendingKickoff(): void {
    const kind = this.pendingKickoff;
    if (!kind || this.kickoffIssued || this.closed) return;
    if (!this.xaiWs || this.xaiWs.readyState !== WebSocket.OPEN) return;

    // Dashboard voice should never auto-greet as a crew call.
    if (!this.isCrewCallSession()) {
      this.pendingKickoff = null;
      return;
    }

    // Hold/resume or mid-call reconnect: continue silently with seeded history.
    if (kind === 'resume' || this.hasSeededSpokenHistory) {
      this.kickoffIssued = true;
      this.pendingKickoff = null;
      getLogger().info('XAI_VOICE', `Silent call ${kind} — no greeting (continuing same call)`);
      this.setState(this.mode === 'duplex' ? 'listening' : 'idle');
      return;
    }

    const host = this.resolveCrewCallHost();
    if (!host) {
      getLogger().warn('XAI_VOICE', 'Call kickoff: crew host unresolved — greeting anyway with session instructions');
    }
    const openerIdentity = host
      ? { name: host.name, title: host.title, expertise: host.expertise }
      : null;
    const who = host
      ? `${host.name}${host.title ? ` (${host.title})` : ''}`
      : 'your named persona';

    this.kickoffIssued = true;
    this.pendingKickoff = null;
    this.greetingInFlight = true;
    getLogger().info('XAI_VOICE', `Issuing call greeting kickoff (${kind}) as ${who}`);

    // Inject opener guidance and ask the model to speak first (realtime audio — no ⟨voice⟩ tags).
    this.sendXai({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `[Call connected. Speak first as ${who} — introduce yourself by name/role and open with one persona-fit question. Never say "crew".]`,
        }],
      },
    });
    this.sendXai({
      type: 'response.create',
      response: {
        instructions: buildCrewCallRealtimeOpenerInstruction('open', openerIdentity),
      },
    });
    // Stay in listening until audio/text arrives — UI maps greeting to purple speaking,
    // not orange Thinking… (running/processing before first audio looked like a hang).
    this.setState(this.mode === 'duplex' ? 'listening' : 'idle');
    this.transport.sendControl({
      type: 'agent_status',
      sessionId: this.sessionId,
      status: 'speaking',
      text: undefined,
      greeting: true,
    });
  }

  private getPersona() {
    try {
      return getPersonaStore().get();
    } catch {
      return null;
    }
  }

  /** Voice uses its own ToolService; crew_create_custom still writes through the live Agent roster. */
  private bindLiveCrewAgent(): void {
    try {
      const agent = getEngine().agent;
      if (agent) setCustomCrewCreateAgent(agent);
    } catch {
      /* engine may still be booting */
    }
  }

  private setupPermissionHandler(): void {
    const executor = this.toolService.getToolExecutor();
    executor.setPermissionRequestHandler(async (toolId, _path, riskLevel, context) => {
      const requestId = randomUUID();
      const { argsSummary, commandPreview } = summarizePermissionArgs(
        (context?.args as Record<string, unknown> | undefined) ?? undefined,
      );
      return new Promise<PermissionHandlerResult>((resolve) => {
        this.permissionGate.add(
          {
            requestId,
            tool: toolId,
            riskLevel,
            argsSummary: argsSummary || commandPreview,
          },
          resolve,
        );
      });
    });
  }

  async announce(line: string, context?: string): Promise<void> {
    if (context) this.injectContextItem(context);
    await this.speakSystemLine(line);
  }

  private async speakSystemLine(line: string): Promise<void> {
    if (!line.trim() || this.closed) return;
    this.systemAnnounce = true;
    try {
      if (this.currentResponseId) {
        this.sendXai({ type: 'response.cancel', response_id: this.currentResponseId });
        this.currentResponseId = undefined;
      }
      await this.transport.stopPlayback();
    } catch { /* ignore */ }
    try {
      const stream = await getVoiceService().synthesizeStreamText(line, { requestId: randomUUID() });
      this.setState('speaking');
      this.transport.sendControl({
        type: 'agent_status',
        sessionId: this.sessionId,
        status: 'speaking',
        text: line,
      });
      for await (const chunk of stream.chunks) {
        if (this.closed) break;
        await this.transport.playAudio(
          Buffer.from(chunk.pcmBase64, 'base64'),
          chunk.sampleRate,
          { system: true },
        );
      }
      if (!this.closed) {
        this.transport.sendControl({ type: 'audio_end', sessionId: this.sessionId });
      }
    } catch (err) {
      getLogger().warn(
        'XAI_VOICE',
        `System announce TTS failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.systemAnnounce = false;
      if (!this.closed) {
        this.setState(this.mode === 'duplex' ? 'listening' : 'idle');
        this.transport.sendControl({
          type: 'agent_status',
          sessionId: this.sessionId,
          status: this.mode === 'duplex' ? 'listening' : 'complete',
        });
      }
    }
  }

  private async handleXaiEvent(event: Record<string, unknown>): Promise<void> {
    const type = String(event.type ?? '');
    // Log VAD-related events for debugging endpointing issues
    if (type.startsWith('input_audio_buffer') || type === 'session.updated' || type === 'error' || type === 'response.created') {
      getLogger().info('XAI_VOICE', `event: ${type} ${JSON.stringify({ ...event, type: undefined })}`);
    }
    // xAI may confirm session.update with a bare `{ session: {...} }` event (no `type`)
    // in addition to the standard `session.updated` typed event.
    if (!type && event.session) {
      await this.handleSessionUpdated();
      return;
    }
    // Same for conversation.created occasionally arriving without a type field.
    if ((!type || type === 'conversation.created') && event.conversation) {
      const conv = event.conversation as { id?: string };
      const id = typeof conv?.id === 'string' ? conv.id.trim() : '';
      if (id) this.handleConversationCreated(id);
      if (!type) return;
    }
    switch (type) {
      case 'conversation.created':
        // Handled above (shared with untyped payload).
        break;
      case 'session.created':
        // xAI confirms the socket; session.updated should follow session.update.
        if (!this.ready) {
          void this.handleSessionUpdated();
        }
        break;
      case 'session.updated':
        await this.handleSessionUpdated();
        break;
      case 'input_audio_buffer.speech_started':
        this.handleSpeechStarted();
        break;
      case 'input_audio_buffer.speech_stopped':
        void this.handleSpeechStopped();
        break;
      case 'input_audio_buffer.committed':
        // No-op — transcript events carry the final text.
        break;
      case 'conversation.item.input_audio_transcription.updated':
        this.userTranscript = String(event.transcript ?? this.userTranscript);
        this.transport.sendControl({
          type: 'transcript_partial',
          sessionId: this.sessionId,
          text: this.userTranscript,
          empty: false,
        });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.transcriptCompletedChain = this.transcriptCompletedChain
          .then(() => this.handleUserTranscriptCompleted(event))
          .catch((err: unknown) => {
            getLogger().warn(
              'XAI_VOICE',
              `transcript completed handler failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        break;
      case 'response.created':
        this.handleResponseCreated(event);
        break;
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        this.handleOutputAudioDelta(event);
        break;
      case 'response.output_audio.done':
        this.responseAudioDone = true;
        // Do not mark responseDoneReceived here — xAI often sends function_call
        // events after the acknowledgment audio segment. Finishing the turn here
        // dropped tool runs and left the agent silent after "Sure, I'll…".
        this.maybeContinueAfterToolCalls();
        if (!this.responseDoneReceived && !this.responseDoneFallbackTimer) {
          this.responseDoneFallbackTimer = setTimeout(() => {
            this.responseDoneFallbackTimer = undefined;
            if (!this.responseDoneReceived && !this.closed) {
              getLogger().warn('XAI_VOICE', 'response.done not received — using output_audio.done fallback');
              this.responseDoneReceived = true;
              this.maybeContinueAfterToolCalls();
            }
          }, 2_000);
        }
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.text.delta':
      case 'response.output_text.delta':
        this.handleAssistantTranscriptDelta(event);
        break;
      case 'response.output_audio_transcript.done':
      case 'response.text.done':
      case 'response.output_text.done':
        // Final transcript handled on response.done to ensure completeness.
        break;
      case 'response.function_call_arguments.done':
        await this.handleFunctionCall(event);
        break;
      case 'response.output_item.done': {
        const item = event.item as Record<string, unknown> | undefined;
        const itemType = String(item?.type ?? '');
        if (item && (itemType === 'function_call' || itemType === 'tool_call')) {
          await this.handleFunctionCall({
            call_id: item.call_id,
            name: item.name,
            arguments: item.arguments,
          });
        }
        break;
      }
      case 'response.done':
        await this.handleResponseDone(event);
        break;
      case 'error': {
        const errMsg = String(
          (event.error as { message?: string } | undefined)?.message
          ?? event.message
          ?? 'xAI realtime error',
        );
        if (!this.ready && this.maybeRetryConnectWithoutConversationId(errMsg)) break;
        this.setState('error');
        this.sendError(errMsg);
        break;
      }
      default:
        break;
    }
  }

  private handleXaiAudio(data: Buffer): void {
    if (this.closed) return;
    // After barge-in, currentResponseId is cleared and state is 'listening'.
    // Drop late-arriving audio frames from the cancelled response so they
    // don't undo the interruption by setting state back to 'speaking'.
    if (!this.currentResponseId) return;
    if (this.state !== 'speaking' && this.state !== 'processing') return;
    if (this.state !== 'speaking') {
      this.speakingStartedAt = Date.now();
    }
    this.setState('speaking');
    void this.transport.playAudio(data, OUTPUT_SAMPLE_RATE);
  }

  private handleConversationCreated(conversationId: string): void {
    const key = this.voiceSessionKey();
    if (this.persistedConversationId) {
      if (conversationId !== this.persistedConversationId) {
        getLogger().warn(
          'XAI_VOICE',
          `xAI returned conversation ${conversationId} but keeping durable id ${this.persistedConversationId}`,
        );
      }
      return;
    }
    this.persistedConversationId = conversationId;
    void persistXaiConversationId(key, conversationId)
      .then(() => getLogger().info('XAI_VOICE', `Persisted durable xAI conversation id for ${key}`))
      .catch((err: unknown) => {
        getLogger().warn(
          'XAI_VOICE',
          `Failed to persist conversation id: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private async handleSessionUpdated(): Promise<void> {
    if (this.ready) return;
    if (this.forceReadyTimer) {
      clearTimeout(this.forceReadyTimer);
      this.forceReadyTimer = undefined;
    }
    this.ready = true;
    // Tell the browser the uplink is live immediately — do not await context
    // injection (summary LLM) before session_ready.
    await this.transport.start();
    this.setState(this.mode === 'duplex' ? 'listening' : 'idle');

    // Context in the background. Kickoff is CLIENT-driven only (call_kickoff) so
    // we never jump straight to orange "Thinking…" before blue connect / purple greeting.
    void (async () => {
      try {
        await this.applyContextPolicy();
      } catch (err) {
        getLogger().warn(
          'XAI_VOICE',
          `applyContextPolicy failed after ready: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // If the client already queued kickoff while we were injecting context, flush it.
      if (this.isCrewCallSession() && this.pendingKickoff && !this.kickoffIssued && !this.closed) {
        this.flushPendingKickoff();
      }
    })();
  }

  /** Sync: put the durable chat/voice session into the store cache (required for persist). */
  private ensureChatSessionRecord(): void {
    const id = this.chatSessionId ?? `__channel__:voice`;
    this.chatSessionId = id;
    const eng = getEngine();
    const store = eng.sessionManager.getStorageAdapter();
    if (!store) return;
    if (store.getSession(id)) return;

    const providerId =
      this.config.voice?.provider?.activeProvider
      ?? this.config.provider.activeProvider
      ?? 'xai';
    const modelId =
      this.config.voice?.provider?.activeModel
      ?? this.config.provider.activeModel
      ?? this.model
      ?? 'grok-voice-latest';
    try {
      const { dayKey: listDayKey, dayLabel: listDayLabel } = buildListDayDivider();
      store.createSession({
        id,
        title: id === '__channel__:voice' ? 'Voice' : 'Chat',
        status: 'active',
        providerId,
        modelId,
        scopePath: getAgentFilesDir(),
        tokenAvailable: 128_000,
        tokenUsed: 0,
        listDayKey,
        listDayLabel,
      } as unknown as Omit<StorableSession, 'id' | 'createdAt' | 'updatedAt'>);
    } catch (err) {
      getLogger().error('XAI_VOICE', `Failed to create voice session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Async: load recent messages — never required before connect / persist. */
  private async hydrateChatSessionMessages(): Promise<void> {
    const id = this.chatSessionId ?? `__channel__:voice`;
    this.chatSessionId = id;
    this.ensureChatSessionRecord();
    const eng = getEngine();
    const store = eng.sessionManager.getStorageAdapter();
    if (!store?.ensureSessionHydrated) return;
    try {
      await Promise.race([
        Promise.resolve(store.ensureSessionHydrated(id)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hydrate timeout')), 2_000)),
      ]);
    } catch { /* ignore — voice uplink must not wait on storage */ }
    seedCallDividerClockFromStore(id);
  }

  /**
   * Idle-based context policy (never rotates conversation_id):
   * - hot  (<25m idle): rely on xAI resumption cache — inject nothing
   * - warm (25–120m): summary + recent delta reminder
   * - cold (>120m): summary only (rebuild at most once/day)
   * - fresh: no prior activity — nothing to inject
   */
  private async applyContextPolicy(): Promise<void> {
    const key = this.voiceSessionKey();
    const priorMsgs = await loadVoiceSessionMessages(key);
    const hadPrior = priorMsgs.length > 0 || Boolean(this.persistedConversationId);

    if (this.idleBand === 'hot') {
      this.hasSeededSpokenHistory = hadPrior;
      getLogger().info('XAI_VOICE', `Context policy hot — resume cache, no inject (${key})`);
      return;
    }

    if (this.idleBand === 'fresh') {
      this.hasSeededSpokenHistory = priorMsgs.length > 0;
      getLogger().info('XAI_VOICE', `Context policy fresh — cold start (${key})`);
      return;
    }

    if (this.idleBand === 'warm') {
      let state = await loadVoiceRealtimeState(key);
      // Prefer an existing summary; build one if missing and history exists (still ≤1/day).
      let summary = state?.summary?.trim() || null;
      if (!summary && priorMsgs.length > 0) {
        summary = (await ensureVoiceSessionSummary(key))?.trim() || null;
        state = await loadVoiceRealtimeState(key);
      }
      const recent = await loadRecentVoiceDelta(key, state?.summaryUpdatedAt);
      if (!summary && recent.length === 0) {
        this.hasSeededSpokenHistory = false;
        getLogger().info('XAI_VOICE', `Context policy warm — nothing to remind (${key})`);
        return;
      }
      const idle = idleMsSince(this.lastVoiceActiveAt) ?? XAI_RESUME_IDLE_MS;
      const text = buildWarmReminderText(summary, recent, idle / 60_000);
      this.injectContextItem(text);
      this.hasSeededSpokenHistory = true;
      getLogger().info(
        'XAI_VOICE',
        `Context policy warm — reminded with summary=${Boolean(summary)} recent=${recent.length} (${key})`,
      );
      return;
    }

    // cold — summary only
    const summary = await ensureVoiceSessionSummary(key);
    if (!summary?.trim()) {
      this.hasSeededSpokenHistory = priorMsgs.length > 0;
      getLogger().info('XAI_VOICE', `Context policy cold — no summary available (${key})`);
      return;
    }
    this.injectContextItem(buildColdSummaryText(summary));
    this.hasSeededSpokenHistory = true;
    getLogger().info('XAI_VOICE', `Context policy cold — summary only (${key})`);
  }

  private injectContextItem(text: string): void {
    if (!text.trim()) return;
    // Context-only — use system role so duplex create_response does not treat this
    // as a user turn and narrate the whole history into the call transcript.
    this.sendXai({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{
          type: 'input_text',
          text: `[INTERNAL CONTEXT — do not speak this aloud or quote it back]\n${text.trim()}`,
        }],
      },
    });
  }

  private async handleUserTranscriptCompleted(event: Record<string, unknown>): Promise<void> {
    const itemId = String(
      event.item_id
      ?? (event.item as { id?: string } | undefined)?.id
      ?? '',
    ).trim();
    if (itemId) {
      if (this.handledTranscriptItemIds.has(itemId)) {
        getLogger().info('XAI_VOICE', `Skipping duplicate transcription.completed for item ${itemId}`);
        return;
      }
      this.handledTranscriptItemIds.add(itemId);
      if (this.handledTranscriptItemIds.size > 64) {
        const first = this.handledTranscriptItemIds.values().next().value;
        if (first) this.handledTranscriptItemIds.delete(first);
      }
    }

    // Wait for the speaker identification to finish (started in speech_stopped) so
    // the transcript label and xAI instructions are based on the current speaker.
    if (this.pendingSpeakerPromise) {
      await this.pendingSpeakerPromise;
    }
    const rawText = String(event.transcript ?? this.userTranscript);
    this.userTranscript = '';
    const speaker = this.currentSpeaker ?? (this.voiceprintEnabled ? null : this.defaultRootSpeaker);
    const speakerPayload = speaker ? { speakerName: speaker.name } : {};

    // Wake-word gating for xAI: non-wake turns outside the idle window are dropped.
    let text = rawText;
    let isWakeOnly = false;
    if (this.wakeWordEnabled && this.mode === 'duplex' && rawText.trim()) {
      const inIdle = isInWakeIdle(this.wakeIdleUntil);
      const { startsWith, stripped } = tryStripWakePhrase(rawText, this.wakePhrase);
      if (!inIdle && !startsWith) {
        this.transport.sendControl({ type: 'transcript_final', sessionId: this.sessionId, text: '', empty: true, ...speakerPayload });
        return;
      }
      if (startsWith) {
        isWakeOnly = !stripped.trim();
        text = stripped;
        this.wakeIdleUntil = Date.now() + WAKE_WORD_IDLE_MS;
        this.sendWakeIdle();
      }
    }

    if (!text.trim()) {
      this.transport.sendControl({ type: 'transcript_final', sessionId: this.sessionId, text: '', empty: true, ...speakerPayload });
      if (this.wakeWordEnabled && isWakeOnly && this.mode === 'duplex') {
        this.speakWakeAck();
      }
      return;
    }

    const normalized = text.trim().toLowerCase();
    const now = Date.now();
    if (
      normalized
      && normalized === this.lastEmittedUserTranscript
      && now - this.lastEmittedUserTranscriptAt < VOICE_USER_TRANSCRIPT_DEDUP_MS
    ) {
      getLogger().info('XAI_VOICE', 'Skipping duplicate user transcript within dedup window');
      return;
    }
    this.lastEmittedUserTranscript = normalized;
    this.lastEmittedUserTranscriptAt = now;

    this.transport.sendControl({ type: 'transcript_final', sessionId: this.sessionId, text, empty: false, ...speakerPayload });

    if (this.permissionGate.pending) {
      if (this.currentResponseId) {
        this.sendXai({ type: 'response.cancel', response_id: this.currentResponseId });
        this.currentResponseId = undefined;
      }
      await this.permissionGate.handleUtterance(text);
      return;
    }

    this.persistUserMessage(text);
    this.applyUserActionConsent(text);
    if ((this.chatSessionId ?? '__channel__:voice') === '__channel__:voice') {
      const { maybePresentWhatsAppVisual } = await import('../../visual-present.js');
      maybePresentWhatsAppVisual(text);
    }
    // xAI only auto-responds when create_response is true. In wake-word mode we
    // trigger the response after a valid (accepted or idle-continued) turn.
    if (this.wakeWordEnabled) {
      this.sendXai({ type: 'response.create' });
    }
  }

  /** Notify the client of the current wake-word idle window so the footer can show
   *  when the wake listener is paused (idle) vs armed (active). */
  private sendWakeIdle(): void {
    if (!this.wakeWordEnabled) return;
    this.transport.sendControl({
      type: 'wake_idle',
      sessionId: this.sessionId,
      until: this.wakeIdleUntil,
      active: isInWakeIdle(this.wakeIdleUntil),
    });
  }

  /** Trigger a short random ack response after the user only says the wake word. */
  private speakWakeAck(): void {
    const callsign = this.config.user?.callsign?.trim() || 'sir';
    const ack = pickWakeAck(callsign);
    this.sendXai({
      type: 'response.create',
      instructions: `Say "${ack}" briefly, then stop and wait for the next user message. Do not say anything else.`,
    });
  }

  private applyUserActionConsent(text: string): void {
    this.lastUserUtterance = text;
    const result = applyInstructedActionConsent(
      this.toolService.getToolExecutor(),
      text,
      this.lastAssistantUtterance,
    );
    if (result.granted.length || result.waived || result.explicit || result.affirmative) {
      getLogger().info(
        'XAI_VOICE',
        `Action consent user="${text.slice(0, 80)}" explicit=${result.explicit} affirmative=${result.affirmative} waived=${result.waived} granted=${result.granted.length}`,
      );
    }
  }

  private persistUserMessage(text: string): void {
    this.lastUserUtterance = text;
    this.ensureChatSessionRecord();
    const id = this.chatSessionId ?? '__channel__:voice';
    const speaker = this.currentSpeaker ?? (this.voiceprintEnabled ? null : this.defaultRootSpeaker);
    const metadata: MessageMetadata = {
      engine: 'realtime_xai',
      provider: 'xai',
      model: this.model,
    };
    if (speaker) {
      metadata.speakerId = speaker.id ?? null;
      metadata.speakerName = speaker.name ?? 'anonymous';
    }
    if (isCrewVoiceSessionId(id)) {
      const divider = takeCallDividerForPersist(id);
      if (divider) metadata.callDivider = divider;
    }
    try { persistMessageDirect(id, 'user', text, { metadata }); } catch { /* best-effort */ }
    this.markVoiceActive();
  }

  private eventResponseId(event: Record<string, unknown>): string | undefined {
    const fromEvent = event.response_id;
    if (typeof fromEvent === 'string' && fromEvent) return fromEvent;
    const responseObj = event.response as { id?: string } | undefined;
    if (typeof responseObj?.id === 'string' && responseObj.id) return responseObj.id;
    return undefined;
  }

  /**
   * Persist the current assistant transcript as its own DB row without ending
   * the duplex turn. Consecutive xAI responses (thought → speech, tool ack →
   * answer) must not overwrite the previous utterance.
   */
  private persistCurrentAssistantUtterance(): boolean {
    const text = this.assistantText.trim();
    if (!text) return false;
    this.persistAssistantMessage(text);
    this.assistantText = '';
    return true;
  }

  private handleResponseCreated(event: Record<string, unknown>): void {
    // A new response.created can arrive before the previous response.done.
    // Flush the prior transcript first so it is not wiped.
    this.persistCurrentAssistantUtterance();
    this.currentResponseId = this.eventResponseId(event);
    this.assistantText = '';
    // xAI emits a new response.created for post-tool speech and VAD turns.
    // Wiping tool state here dropped in-flight save_to_article / function outputs.
    const toolsInFlight = this.toolCallProcessing || this.toolCalls.length > 0;
    if (!toolsInFlight) {
      this.toolCalls = [];
      this.pendingToolCallIndex = 0;
      this.toolCallProcessing = false;
      this.responseDoneReceived = false;
    }
    this.responseAudioDone = false;
    this.playbackFinished = false;
    this.responseFinished = false;
    this.speakingStartedAt = 0;
    if (this.greetingInFlight) {
      // Greeting: stay on speaking (purple) — never flash orange Thinking…
      this.setState('speaking');
      this.transport.sendControl({
        type: 'agent_status',
        sessionId: this.sessionId,
        status: 'speaking',
        greeting: true,
      });
      return;
    }
    this.setState('processing');
    this.transport.sendControl({ type: 'agent_status', sessionId: this.sessionId, status: 'running' });
  }

  private handleOutputAudioDelta(event: Record<string, unknown>): void {
    // After barge-in, currentResponseId is cleared — ignore all stale audio
    // deltas so the old response's audio doesn't keep playing.
    if (!this.currentResponseId) return;
    const responseId = event.response_id as string | undefined;
    if (responseId && responseId !== this.currentResponseId) return;
    const delta = event.delta;
    if (typeof delta === 'string' && delta.length > 0) {
      const pcm = Buffer.from(delta, 'base64');
      if (this.state !== 'speaking') {
        this.speakingStartedAt = Date.now();
        this.setState('speaking');
        this.transport.sendControl({ type: 'agent_status', sessionId: this.sessionId, status: 'speaking' });
      }
      void this.transport.playAudio(pcm, OUTPUT_SAMPLE_RATE);
    }
  }

  private handleAssistantTranscriptDelta(event: Record<string, unknown>): void {
    // After barge-in, currentResponseId is cleared — ignore stale transcript.
    if (!this.currentResponseId) return;
    const responseId = event.response_id as string | undefined;
    if (responseId && responseId !== this.currentResponseId) return;
    const delta = String(event.delta ?? '');
    if (!delta) return;
    this.assistantText += delta;
    // Transition to 'speaking' on text deltas too — not just audio deltas.
    // This prevents the turn from finishing prematurely when xAI sends a
    // text-only response (no audio) or when audio arrives after text.
    if (this.state !== 'speaking') {
      this.setState('speaking');
    }
    this.transport.sendControl({
      type: 'agent_status',
      sessionId: this.sessionId,
      status: 'speaking',
      text: this.assistantText.trim(),
    });
  }

  private async handleFunctionCall(event: Record<string, unknown>): Promise<void> {
    const call_id = String(event.call_id ?? '');
    const name = String(event.name ?? '');
    const argsString = String(event.arguments ?? '{}');
    if (!call_id || !name) return;
    if (this.toolCalls.some((c) => c.call_id === call_id)) return;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(argsString) as Record<string, unknown>; } catch {
      getLogger().warn('XAI_VOICE', `Failed to parse function arguments for ${name}`);
    }
    getLogger().info('XAI_VOICE', `function_call ${name} call_id=${call_id}`);
    this.toolCalls.push({ call_id, name, args });
    if (this.responseDoneReceived) void this.processToolCalls();
  }

  private async processToolCalls(): Promise<void> {
    if (this.toolCallProcessing) return;
    if (!this.responseDoneReceived) return;
    this.toolCallProcessing = true;
    const start = this.pendingToolCallIndex;
    const batch = this.toolCalls.slice(start);
    const sessionId = this.chatSessionId ?? this.sessionId;
    this.bindLiveCrewAgent();
    const permResults = await Promise.all(batch.map(async (item) => {
      try {
        return await this.toolService.requestPermission(item.name, item.args, sessionId);
      } catch {
        return { decision: 'deny' as const };
      }
    }));
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      if (!item) continue;
      this.pendingToolCallIndex = start + i + 1;
      const perm = permResults[i];
      if (!perm || perm.decision === 'deny') {
        getLogger().warn(
          'XAI_VOICE',
          `tool ${item.name} denied decision=${perm?.decision ?? 'none'} error=${perm?.error ?? ''}`,
        );
        item.result = {
          success: false,
          output: perm && 'instruction' in perm && perm.instruction
            ? perm.instruction
            : 'Permission denied. Action was NOT performed.',
          error: perm?.error ?? 'PERMISSION_DENIED',
        };
        continue;
      }
      try {
        item.result = await this.toolService.execute(item.name, item.args, sessionId);
        getLogger().info(
          'XAI_VOICE',
          `tool ${item.name} executed success=${item.result.success}`,
        );
      } catch (err) {
        item.result = {
          success: false,
          output: err instanceof Error ? err.message : String(err),
          error: 'EXECUTION_ERROR',
        };
      }
    }
    this.toolCallProcessing = false;
    this.maybeContinueAfterToolCalls();
  }

  private async handleResponseDone(event: Record<string, unknown>): Promise<void> {
    if (this.responseDoneFallbackTimer) {
      clearTimeout(this.responseDoneFallbackTimer);
      this.responseDoneFallbackTimer = undefined;
    }
    const doneId = this.eventResponseId(event);
    // Stale done for a previous response — already flushed when the next
    // response.created arrived. Do not end the in-flight response.
    if (doneId && this.currentResponseId && doneId !== this.currentResponseId) {
      return;
    }
    this.responseDoneReceived = true;
    const responseObj = event.response as { status?: string } | undefined;
    const status = responseObj?.status ?? event.status;
    if (status === 'cancelled') {
      // Barge-in / cancelled: drop the partial. Incomplete thought/speech still
      // persists below via finishResponseTurn.
      this.assistantText = '';
      // Cancelling a spurious turn (e.g. the user said "yes" to a permission
      // prompt) must not wipe in-flight tool calls waiting on confirmation.
      if (this.toolCallProcessing || this.permissionGate.pending) {
        return;
      }
      this.toolCalls = [];
      this.pendingToolCallIndex = 0;
      this.finishResponseTurn();
      return;
    }
    if (status === 'incomplete') {
      if (this.toolCallProcessing || this.permissionGate.pending) {
        return;
      }
      this.toolCalls = [];
      this.pendingToolCallIndex = 0;
      this.finishResponseTurn();
      return;
    }
    if (this.toolCalls.length > 0) {
      void this.processToolCalls();
      return;
    }
    this.maybeContinueAfterToolCalls();
  }

  private maybeContinueAfterToolCalls(): void {
    if (this.toolCallProcessing) return;
    if (this.pendingToolCallIndex < this.toolCalls.length) {
      void this.processToolCalls();
      return;
    }
    if (this.toolCalls.length > 0) {
      // Only send tool outputs once the response has finished streaming.
      if (this.responseDoneReceived) {
        void this.sendFunctionOutputsAndContinue();
      }
      return;
    }
    if (this.responseDoneReceived && !this.responseFinished) {
      this.finishResponseTurn();
    }
  }

  private clearPlaybackContinueTimer(): void {
    if (this.playbackContinueTimer) {
      clearTimeout(this.playbackContinueTimer);
      this.playbackContinueTimer = undefined;
    }
  }

  private async sendFunctionOutputsAndContinue(): Promise<void> {
    if (!this.responseDoneReceived) return;
    // Wait for client playback drain when acknowledgment audio is still playing.
    if (this.mode === 'duplex' && !this.playbackFinished && this.responseAudioDone) {
      if (!this.playbackContinueTimer) {
        this.playbackContinueTimer = setTimeout(() => {
          this.playbackContinueTimer = undefined;
          if (!this.playbackFinished && !this.closed) {
            getLogger().warn('XAI_VOICE', 'playback_finished not received — continuing after tool ack audio');
            this.playbackFinished = true;
            void this.sendFunctionOutputsAndContinue();
          }
        }, 2_500);
      }
      return;
    }
    this.clearPlaybackContinueTimer();
    // Flush even if a later response.created cleared the done flag — tools
    // already ran and the model is waiting on function_call_output.
    this.responseDoneReceived = true;
    const outputs = this.toolCalls.filter((c) => c.result);
    for (const call of outputs) {
      const result = call.result!;
      const output = JSON.stringify({
        success: result.success,
        output: result.output,
        error: result.error,
      });
      this.sendXai({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        },
      });
    }
    this.toolCalls = [];
    this.pendingToolCallIndex = 0;
    this.responseAudioDone = false;
    this.playbackFinished = false;
    this.persistCurrentAssistantUtterance();
    this.responseFinished = false;
    this.sendXai({ type: 'response.create' });
  }

  private finishResponseTurn(): void {
    if (this.responseFinished) return;
    this.responseFinished = true;
    const wasGreeting = this.greetingInFlight;
    this.greetingInFlight = false;
    const text = this.assistantText.trim();
    this.persistCurrentAssistantUtterance();
    if (text) {
      this.transport.sendControl({
        type: 'agent_status',
        sessionId: this.sessionId,
        status: 'complete',
        text,
        ...(wasGreeting ? { greeting: true } : {}),
      });
    } else {
      this.transport.sendControl({
        type: 'agent_status',
        sessionId: this.sessionId,
        status: 'complete',
        ...(wasGreeting ? { greeting: true } : {}),
      });
    }
    void this.transport.endTurn();
    this.setState(this.mode === 'duplex' ? 'listening' : 'idle');
    this.assistantText = '';
    this.toolCalls = [];
    this.pendingToolCallIndex = 0;
    this.responseDoneReceived = false;
    this.responseAudioDone = false;
    this.playbackFinished = false;
    this.currentResponseId = undefined;
  }

  private persistAssistantMessage(text: string): void {
    this.ensureChatSessionRecord();
    const id = this.chatSessionId ?? '__channel__:voice';
    const metadata: MessageMetadata = {
      engine: 'realtime_xai',
      provider: 'xai',
      model: this.model,
    };
    if (isCrewVoiceSessionId(id)) {
      const divider = takeCallDividerForPersist(id);
      if (divider) metadata.callDivider = divider;
    }
    this.lastAssistantUtterance = text;
    try { persistMessageDirect(id, 'assistant', text, { metadata }); } catch { /* best-effort */ }
    this.markVoiceActive();
  }

  private handleSpeechStarted(): void {
    if (this.systemAnnounce) return;
    // Barge-in only while assistant audio is actively playing — not during the
    // processing/tool window after acknowledgment TTS (cafe noise was cancelling
    // tool runs via spurious speech_started during processing).
    if (this.state !== 'speaking') return;
    if (!this.currentResponseId) return;
    // Ignore the first ~1s of TTS — speaker bleed / AEC settle often fires a
    // spurious speech_started right when playback begins. This window matches the
    // client-side playback grace so echo can't trip xAI's server-side barge-in.
    if (this.speakingStartedAt > 0 && Date.now() - this.speakingStartedAt < this.BARGE_IN_GRACE_MS) {
      getLogger().info('XAI_VOICE', 'Ignoring early speech_started during barge-in grace window');
      return;
    }
    const cancelledResponseId = this.currentResponseId;
    this.currentResponseId = undefined;
    this.speakingStartedAt = 0;
    this.realtimeAudioChunks = [];
    this.pendingSpeakerPromise = null;
    this.realtimeRecording = true;
    void this.transport.stopPlayback();
    this.transport.sendControl({ type: 'agent_status', sessionId: this.sessionId, status: 'listening' });
    // xAI realtime with server VAD is supposed to cancel automatically when
    // interrupt_response is true, but empirically the assistant often keeps
    // talking. Send an explicit response.cancel for the current response so the
    // server stops generating audio immediately.
    if (cancelledResponseId) {
      this.sendXai({ type: 'response.cancel', response_id: cancelledResponseId });
    }
    this.assistantText = '';
    this.toolCalls = [];
    this.pendingToolCallIndex = 0;
    this.responseAudioDone = false;
    this.playbackFinished = false;
    this.currentSpeaker = null;
    this.setState('listening');
  }

  private handleSpeechStopped(): void {
    this.realtimeRecording = false;
    const pcm = Buffer.concat(this.realtimeAudioChunks);
    this.realtimeAudioChunks = [];
    if (pcm.length === 0) {
      this.pendingSpeakerPromise = Promise.resolve();
      return;
    }
    this.pendingSpeakerPromise = this.resolveSpeaker(pcm);
  }

  private async resolveSpeaker(pcm: Buffer): Promise<void> {
    const callsign = this.config.user?.callsign?.trim() || 'Root';
    if (!this.voiceprintEnabled) {
      this.currentSpeaker = { ...this.defaultRootSpeaker, name: callsign };
      await this.refreshToolsAndSessionUpdate();
      return;
    }
    try {
      const result = await getVoiceService().identifySpeaker(pcm, VOICE_SAMPLE_RATE);
      if (!result.available) {
        getLogger().info('XAI_VOICE', 'Speaker identification unavailable (voiceprint assets not installed)');
        this.currentSpeaker = null;
        return;
      }
      if (!result.recognized) {
        getLogger().info('XAI_VOICE', 'Speaker not recognized (below threshold)');
        this.currentSpeaker = null;
        return;
      }
      const isRoot = result.isRoot ?? false;
      this.currentSpeaker = {
        id: result.speakerId ?? null,
        name: isRoot ? callsign : (result.speakerName ?? 'anonymous'),
        isRoot,
        confidence: result.confidence,
        recognized: true,
      };
      getLogger().info('XAI_VOICE', `Speaker identified: ${this.currentSpeaker.name} (recognized=${result.recognized}, isRoot=${result.isRoot}, confidence=${result.confidence})`);
      // Refresh instructions so xAI can address the current speaker.
      await this.refreshToolsAndSessionUpdate();
    } catch (err) {
      getLogger().warn('XAI_VOICE', `Speaker identification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleAudioStart(): Promise<void> {
    // For xAI realtime, an incoming audio_start is a new turn marker. Stop local
    // playback and clear the user audio buffer, but do not send response.cancel
    // because it is not reliably supported by the xAI realtime endpoint.
    if (this.state === 'speaking' || this.state === 'processing') {
      this.sendXai({ type: 'input_audio_buffer.clear' });
      this.toolCalls = [];
      this.pendingToolCallIndex = 0;
      this.assistantText = '';
      await this.transport.stopPlayback();
    }
    this.userTranscript = '';
    // In push-to-talk mode the client controls the speech boundaries, so we
    // record audio here. In VAD mode we wait for xAI's speech_started event.
    if (this.mode === 'push-to-talk') {
      this.currentSpeaker = null;
      this.pendingSpeakerPromise = null;
      this.realtimeAudioChunks = [];
      this.realtimeRecording = true;
    }
    this.setState('listening');
  }

  private async handleAudioEnd(): Promise<void> {
    if (this.mode !== 'push-to-talk') return;
    this.realtimeRecording = false;
    const pcm = Buffer.concat(this.realtimeAudioChunks);
    this.realtimeAudioChunks = [];
    this.pendingSpeakerPromise = pcm.length > 0 ? this.resolveSpeaker(pcm) : Promise.resolve();
    this.sendXai({ type: 'input_audio_buffer.commit' });
    this.setState('processing');
  }

  private async handlePlaybackFinished(): Promise<void> {
    this.playbackFinished = true;
    this.clearPlaybackContinueTimer();
    this.maybeContinueAfterToolCalls();
  }

  private async handlePlaybackInterrupted(): Promise<void> {
    // Duplex xAI: the user started talking while the assistant was speaking.
    // Cancel the in-flight response immediately but keep the user's audio in the
    // input buffer so xAI can transcribe/answer it. In PTT mode, the user is
    // manually aborting an in-progress playback and has not started a new turn,
    // so it is safe to discard any buffered user audio.
    if (this.permissionGate.pending) {
      // Barge-in is how the user answers the spoken permission prompt.
      await this.transport.stopPlayback();
      if (this.mode === 'duplex') {
        this.setState('listening');
        this.transport.sendControl({ type: 'agent_status', sessionId: this.sessionId, status: 'listening' });
      }
      return;
    }
    if (this.mode === 'duplex') {
      const cancelledResponseId = this.currentResponseId;
      this.currentResponseId = undefined;
      this.speakingStartedAt = 0;
      this.realtimeAudioChunks = [];
      this.pendingSpeakerPromise = null;
      this.realtimeRecording = true;
      if (cancelledResponseId) {
        this.sendXai({ type: 'response.cancel', response_id: cancelledResponseId });
      }
    } else {
      this.sendXai({ type: 'input_audio_buffer.clear' });
    }
    await this.transport.stopPlayback();
    this.userTranscript = '';
    this.assistantText = '';
    this.toolCalls = [];
    this.pendingToolCallIndex = 0;
    this.permissionGate.cancelAll('deny');
    if (this.mode === 'duplex') {
      this.setState('listening');
      this.transport.sendControl({ type: 'agent_status', sessionId: this.sessionId, status: 'listening' });
    } else {
      this.setState('idle');
    }
  }

  private handlePermissionResponse(_msg: Record<string, unknown>): void {
    // Voice sessions are spoken-confirmation only — ignore UI/tap decisions.
  }

  private handleVoiceToggle(msg: Record<string, unknown>): void {
    let needsUpdate = false;
    if (typeof msg.searchWeb === 'boolean') {
      if (this.searchWeb !== msg.searchWeb) {
        this.searchWeb = msg.searchWeb;
        needsUpdate = true;
      }
    }
    if (typeof msg.voiceprintEnabled === 'boolean' && this.voiceprintEnabled !== msg.voiceprintEnabled) {
      this.voiceprintEnabled = msg.voiceprintEnabled;
      needsUpdate = true;
    }
    if (needsUpdate) {
      void this.refreshToolsAndSessionUpdate();
    }
  }

  private handleClientSituation(msg: Record<string, unknown>): void {
    const situation = msg.clientSituation ?? msg;
    // Store and refresh instructions on the next session update.
    // For now we keep it minimal and re-apply the existing persona.
    this.clientSituation = situation as ClientSituation;
    void this.refreshToolsAndSessionUpdate();
  }

  private sendXai(payload: Record<string, unknown>): void {
    if (!this.xaiWs || this.xaiWs.readyState !== WebSocket.OPEN) {
      getLogger().warn(
        'XAI_VOICE',
        `Dropping xAI event ${String(payload.type ?? 'unknown')} — WebSocket not open (state=${this.xaiWs?.readyState ?? 'none'})`,
      );
      return;
    }
    this.xaiWs.send(JSON.stringify(payload));
  }

  private sendError(message: string): void {
    getLogger().error('XAI_VOICE', message);
    if (this.closed) return;
    this.transport.sendControl({ type: 'error', sessionId: this.sessionId, message });
    this.setState('error');
  }
}
