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
import { getAgentFilesDir, getLogger } from '@agentx/shared';
import { WebSocketVoiceTransport, ToolService, summarizePermissionArgs } from '@agentx/engine';
import type { VoiceEngineSession, VoiceEngineState } from './types.js';
import { getEngine } from '../../engine.js';
import { persistMessageDirect } from '../../ws.js';
import { loadSessionMessagesPage, buildAgentInstruction } from '../../chat-helpers.js';

const XAI_REALTIME_URL = 'wss://api.x.ai/v1/realtime';
const VOICE_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const PERMISSION_TIMEOUT_MS = 60_000;

interface ToolCallItem {
  call_id: string;
  name: string;
  args: Record<string, unknown>;
  result?: ToolResult;
}

interface PendingPermission {
  resolve: (_value: PermissionHandlerResult) => void;
  call_id: string;
}

export class XaiRealtimeSession implements VoiceEngineSession {
  readonly sessionId: string;
  chatSessionId?: string;
  readonly mode: VoiceSessionMode;

  private state: VoiceEngineState = 'idle';
  private transport: WebSocketVoiceTransport;
  private xaiWs?: WebSocket;
  private config: AgentXConfig;
  private voiceConfig: VoiceConfig;
  private toolService: ToolService;

  private pendingPermissions = new Map<string, PendingPermission>();
  private toolCalls: ToolCallItem[] = [];
  private pendingToolCallIndex = 0;
  private toolCallProcessing = false;
  private responseDoneReceived = false;
  private responseAudioDone = false;
  private playbackFinished = false;
  private responseFinished = false;
  private currentResponseId?: string;
  private assistantText = '';
  private userTranscript = '';
  private searchWeb = false;
  private bypassChip = false;
  private closed = false;
  private ready = false;
  private xaiUrl: string;
  private apiKey: string;
  private model: string;
  private voice: string;
  private clientSituation?: ClientSituation | null;

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
    const baseUrl = this.voiceConfig.xai?.baseUrl ?? XAI_REALTIME_URL;
    const baseWithQuery = baseUrl.includes('?') ? baseUrl : `${baseUrl}?model=${encodeURIComponent(this.model)}`;
    this.xaiUrl = baseWithQuery;
    const scopePath = getAgentFilesDir();
    this.toolService = ToolService.createDefault(scopePath);
    this.setupPermissionHandler();
  }

  getState(): VoiceEngineState {
    return this.state;
  }

  async start(): Promise<void> {
    await this.ensureChatSession();
    this.connect();
    // Wait until the xAI session is configured before returning.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('xAI realtime session timed out')), 30_000);
      const check = () => {
        if (this.ready) {
          clearTimeout(timeout);
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

  onBinaryAudio(pcm: Buffer): void {
    if (this.closed || !this.xaiWs || this.xaiWs.readyState !== WebSocket.OPEN) return;
    this.xaiWs.send(pcm);
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
    this.setState('idle');
    for (const { resolve } of this.pendingPermissions.values()) {
      resolve('deny');
    }
    this.pendingPermissions.clear();
    this.disconnectXai();
    void this.transport.close().catch(() => { /* ignore */ });
  }

  private setState(state: VoiceEngineState): void {
    this.state = state;
  }

  private connect(): void {
    try {
      getLogger().info('XAI_VOICE', `Connecting to xAI realtime: ${this.xaiUrl}`);
      const ws = new WebSocket(this.xaiUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      this.xaiWs = ws;

      ws.on('open', () => {
        getLogger().info('XAI_VOICE', 'xAI realtime WebSocket open');
        try {
          this.sendSessionUpdate();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          getLogger().error('XAI_VOICE', `session.update failed: ${message}`);
          this.sendError(`xAI session update failed: ${message}`);
          this.setState('error');
          this.disconnectXai();
        }
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
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
        getLogger().error('XAI_VOICE', `xAI connection error: ${err.message}`);
        this.sendError(`xAI connection error: ${err.message}`);
        this.setState('error');
        this.disconnectXai();
      });

      ws.on('close', () => {
        if (!this.closed) {
          getLogger().warn('XAI_VOICE', 'xAI realtime WebSocket closed unexpectedly');
          this.sendError('xAI connection closed');
          this.setState('error');
        }
        this.disconnectXai();
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error('XAI_VOICE', `xAI realtime constructor error: ${message}`);
      this.sendError(`Failed to connect to xAI realtime: ${message}`);
      this.setState('error');
    }
  }

  private disconnectXai(): void {
    if (this.xaiWs) {
      try { this.xaiWs.terminate(); } catch { /* ignore */ }
      this.xaiWs = undefined;
    }
  }

  private sendSessionUpdate(): void {
    const registry = this.toolService.getRegistry();
    const toolList = registry.list().filter((t) => t.category !== 'ai_meta' && t.category !== 'agent_meta');
    const tools = registry.toSchemas(toolList);
    // xAI default VAD threshold is 0.85 (very aggressive — cuts off on brief pauses).
    // Use 0.5 for sensitive speech detection + 2000ms silence to require a full
    // 2-second pause before endpointing. This prevents mid-sentence cutoffs.
    const turnDetection = this.mode === 'duplex'
      ? { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 2000 }
      : { type: null };

    const payload = {
      type: 'session.update',
      session: {
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
        tools,
      },
    };
    getLogger().info('XAI_VOICE', `session.update sending turn_detection: ${JSON.stringify(turnDetection)}`);
    this.sendXai(payload);
  }

  private buildInstructions(): string {
    const persona = this.getPersona();
    const parts: string[] = [];
    if (persona) {
      const description = [persona.name, persona.description].filter(Boolean).join(' — ');
      if (description) parts.push(`You are ${description}.`);
      if (persona.communicationStyle) parts.push(`Communication style: ${persona.communicationStyle}`);
      if (persona.decisionMaking) parts.push(`Decision making: ${persona.decisionMaking}`);
      if (persona.domainContext) parts.push(`Domain context: ${persona.domainContext}`);
      if (persona.traits?.length) parts.push(`Traits: ${persona.traits.join(', ')}`);
    }
    parts.push(buildAgentInstruction());
    if (this.searchWeb) parts.push('Use web search when the answer may benefit from current information.');
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
    return parts.filter(Boolean).join('\n\n');
  }

  private getPersona() {
    try {
      const store = getEngine().sessionManager.getStorageAdapter();
      return store?.getPersona?.() ?? null;
    } catch {
      return null;
    }
  }

  private setupPermissionHandler(): void {
    const executor = this.toolService.getToolExecutor();
    executor.setPermissionRequestHandler(async (toolId, _path, riskLevel, context) => {
      if (this.bypassChip) return 'allow_once';
      const requestId = randomUUID();
      const { argsSummary, commandPreview } = summarizePermissionArgs(
        (context?.args as Record<string, unknown> | undefined) ?? undefined,
      );
      return new Promise<PermissionHandlerResult>((resolve) => {
        this.pendingPermissions.set(requestId, { resolve, call_id: '' });
        this.transport.sendControl({
          type: 'permission_prompt',
          sessionId: this.sessionId,
          requestId,
          tool: toolId,
          riskLevel,
          argsSummary: argsSummary ?? '',
          ...(commandPreview ? { commandPreview } : {}),
        });
        // Auto-deny if the user does not respond in time so the realtime turn doesn't hang.
        setTimeout(() => {
          if (this.pendingPermissions.has(requestId)) {
            this.pendingPermissions.delete(requestId);
            resolve('deny');
          }
        }, PERMISSION_TIMEOUT_MS);
      });
    });
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
    switch (type) {
      case 'session.created':
        // No-op — wait for session.updated before considering the session ready.
        break;
      case 'session.updated':
        await this.handleSessionUpdated();
        break;
      case 'input_audio_buffer.speech_started':
        this.handleSpeechStarted();
        break;
      case 'input_audio_buffer.speech_stopped':
        // Server VAD will commit automatically; no action needed.
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
        this.handleUserTranscriptCompleted(event);
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
        // xAI may not send a separate `response.done`; treat audio completion as
        // the end of the response and continue/finish the turn.
        if (!this.responseDoneReceived) {
          this.responseDoneReceived = true;
          this.maybeContinueAfterToolCalls();
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
      case 'response.done':
        await this.handleResponseDone(event);
        break;
      case 'error':
        this.setState('error');
        this.sendError(String(
          (event.error as { message?: string } | undefined)?.message
          ?? event.message
          ?? 'xAI realtime error',
        ));
        break;
      default:
        break;
    }
  }

  private handleXaiAudio(data: Buffer): void {
    if (this.closed) return;
    this.setState('speaking');
    void this.transport.playAudio(data, OUTPUT_SAMPLE_RATE);
  }

  private async handleSessionUpdated(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    await this.seedHistory();
    await this.transport.start();
    this.setState(this.mode === 'duplex' ? 'listening' : 'idle');
  }

  private async ensureChatSession(): Promise<void> {
    const id = this.chatSessionId ?? `__channel__:voice`;
    this.chatSessionId = id;
    const eng = getEngine();
    const store = eng.sessionManager.getStorageAdapter();
    if (!store) return;
    if (store.ensureSessionHydrated) {
      try { await store.ensureSessionHydrated(id); } catch { /* ignore */ }
    }
    const existing = store.getSession(id);
    if (existing) return;

    const providerId = this.config.voice?.provider?.activeProvider ?? this.config.provider.activeProvider;
    const modelId = this.config.voice?.provider?.activeModel ?? this.config.provider.activeModel;
    if (!providerId || !modelId) {
      getLogger().warn('XAI_VOICE', 'No provider/model configured; voice messages may not persist');
      return;
    }
    try {
      store.createSession({
        id,
        title: 'Voice',
        status: 'active',
        providerId,
        modelId,
        scopePath: getAgentFilesDir(),
        tokenAvailable: 128_000,
        tokenUsed: 0,
      } as unknown as Omit<StorableSession, 'id' | 'createdAt' | 'updatedAt'>);
    } catch (err) {
      getLogger().error('XAI_VOICE', `Failed to create voice session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async seedHistory(): Promise<void> {
    const id = this.chatSessionId;
    if (!id) return;
    // For voice-only sessions, seed from the most recent chat session so the
    // voice agent has context from the user's latest conversation.
    const historyId = id === `__channel__:voice` ? this.resolveRecentChatSessionId() : id;
    if (!historyId) return;
    try {
      const page = await loadSessionMessagesPage(historyId, { limit: 20 });
      for (const raw of page.messages) {
        const msg = raw as { role?: string; content?: string };
        if (!msg.content || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
        const contentType = msg.role === 'user' ? 'input_text' : 'text';
        this.sendXai({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: msg.role,
            content: [{ type: contentType, text: msg.content }],
          },
        });
      }
    } catch (err) {
      getLogger().warn('XAI_VOICE', `Failed to seed history: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private resolveRecentChatSessionId(): string | undefined {
    try {
      const eng = getEngine();
      const active = eng.sessionManager.getActiveSession()?.id;
      if (active && active !== '__channel__:voice') return active;
      const core = eng.sessionManager.findAgentXCoreSession()?.id;
      if (core && core !== '__channel__:voice') return core;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private handleUserTranscriptCompleted(event: Record<string, unknown>): void {
    const text = String(event.transcript ?? this.userTranscript);
    this.userTranscript = '';
    if (!text.trim()) {
      this.transport.sendControl({ type: 'transcript_final', sessionId: this.sessionId, text: '', empty: true });
      return;
    }
    this.transport.sendControl({ type: 'transcript_final', sessionId: this.sessionId, text, empty: false });
    this.persistUserMessage(text);
  }

  private persistUserMessage(text: string): void {
    const id = this.chatSessionId ?? this.sessionId;
    const metadata: MessageMetadata = {
      engine: 'realtime_xai',
      provider: 'xai',
      model: this.model,
    };
    try { persistMessageDirect(id, 'user', text, { metadata }); } catch { /* best-effort */ }
  }

  private handleResponseCreated(event: Record<string, unknown>): void {
    this.currentResponseId = String(event.response_id ?? '');
    this.assistantText = '';
    this.toolCalls = [];
    this.pendingToolCallIndex = 0;
    this.toolCallProcessing = false;
    this.responseDoneReceived = false;
    this.responseAudioDone = false;
    this.playbackFinished = false;
    this.responseFinished = false;
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
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(argsString) as Record<string, unknown>; } catch {
      getLogger().warn('XAI_VOICE', `Failed to parse function arguments for ${name}`);
    }
    this.toolCalls.push({ call_id, name, args });
    void this.processToolCalls();
  }

  private async processToolCalls(): Promise<void> {
    if (this.toolCallProcessing) return;
    this.toolCallProcessing = true;
    while (this.pendingToolCallIndex < this.toolCalls.length) {
      const item = this.toolCalls[this.pendingToolCallIndex];
      if (!item) break;
      this.pendingToolCallIndex += 1;
      try {
        item.result = await this.toolService.execute(item.name, item.args, this.chatSessionId ?? this.sessionId);
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
    this.responseDoneReceived = true;
    // A cancelled response should not be persisted or continued.
    if (event.status === 'cancelled' || event.status === 'incomplete') {
      this.assistantText = '';
      this.toolCalls = [];
      this.pendingToolCallIndex = 0;
      this.finishResponseTurn();
      return;
    }
    this.maybeContinueAfterToolCalls();
  }

  private maybeContinueAfterToolCalls(): void {
    if (this.toolCallProcessing) return;
    if (this.pendingToolCallIndex < this.toolCalls.length) return;
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

  private async sendFunctionOutputsAndContinue(): Promise<void> {
    if (!this.responseDoneReceived) return;
    // Wait for playback to finish in duplex mode to avoid overlapping assistant audio.
    if (this.mode === 'duplex' && !this.playbackFinished && this.responseAudioDone) {
      return;
    }
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
    this.assistantText = '';
    this.responseFinished = false;
    this.sendXai({ type: 'response.create' });
  }

  private finishResponseTurn(): void {
    if (this.responseFinished) return;
    this.responseFinished = true;
    const text = this.assistantText.trim();
    if (text) {
      this.persistAssistantMessage(text);
      this.transport.sendControl({
        type: 'agent_status',
        sessionId: this.sessionId,
        status: 'complete',
        text,
      });
    } else {
      this.transport.sendControl({ type: 'agent_status', sessionId: this.sessionId, status: 'complete' });
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
    const id = this.chatSessionId ?? this.sessionId;
    const metadata: MessageMetadata = {
      engine: 'realtime_xai',
      provider: 'xai',
      model: this.model,
    };
    try { persistMessageDirect(id, 'assistant', text, { metadata }); } catch { /* best-effort */ }
  }

  private handleSpeechStarted(): void {
    if (this.state !== 'speaking' && this.state !== 'processing') return;
    // Barge-in: the user started talking over the assistant. Stop local playback,
    // cancel the current xAI response, and tell the client to switch to the
    // listening state immediately. Do NOT clear the input buffer — we want to
    // keep the incoming user speech.
    this.currentResponseId = undefined;
    void this.transport.stopPlayback();
    this.transport.sendControl({ type: 'agent_status', sessionId: this.sessionId, status: 'listening' });
    // Do not send response.cancel — xAI realtime handles the new user audio
    // automatically and may error on an unsupported cancel message. Old response
    // audio deltas are ignored because currentResponseId has been cleared.
    this.assistantText = '';
    this.toolCalls = [];
    this.pendingToolCallIndex = 0;
    this.responseAudioDone = false;
    this.playbackFinished = false;
    this.setState('listening');
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
    this.setState('listening');
  }

  private async handleAudioEnd(): Promise<void> {
    if (this.mode !== 'push-to-talk') return;
    this.sendXai({ type: 'input_audio_buffer.commit' });
    this.setState('processing');
  }

  private async handlePlaybackFinished(): Promise<void> {
    this.playbackFinished = true;
    this.maybeContinueAfterToolCalls();
  }

  private async handlePlaybackInterrupted(): Promise<void> {
    // Avoid response.cancel on xAI realtime; just stop local playback and clear
    // the user buffer. Old assistant audio deltas are dropped when the response
    // finishes or when a new response starts.
    this.sendXai({ type: 'input_audio_buffer.clear' });
    await this.transport.stopPlayback();
    this.userTranscript = '';
    this.assistantText = '';
    this.toolCalls = [];
    this.pendingToolCallIndex = 0;
    for (const { resolve } of this.pendingPermissions.values()) {
      resolve('deny');
    }
    this.pendingPermissions.clear();
    this.setState(this.mode === 'duplex' ? 'listening' : 'idle');
  }

  private handlePermissionResponse(msg: Record<string, unknown>): void {
    const requestId = String(msg.requestId ?? '');
    const choice = String(msg.choice ?? '');
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    let result: PermissionHandlerResult = 'deny';
    if (choice === 'allow_once' || choice === 'approve_all') result = 'allow_once';
    else if (choice === 'allow_always') result = 'allow_always';
    pending.resolve(result);
    this.pendingPermissions.delete(requestId);
  }

  private handleVoiceToggle(msg: Record<string, unknown>): void {
    let needsUpdate = false;
    if (typeof msg.searchWeb === 'boolean') {
      if (this.searchWeb !== msg.searchWeb) {
        this.searchWeb = msg.searchWeb;
        needsUpdate = true;
      }
    }
    if (typeof msg.bypassChip === 'boolean') {
      this.bypassChip = msg.bypassChip;
      if (this.bypassChip) {
        try { this.toolService.getToolExecutor().getPermissionManager().allowAll(); } catch { /* ignore */ }
      }
    }
    if (needsUpdate) {
      this.sendSessionUpdate();
    }
  }

  private handleClientSituation(msg: Record<string, unknown>): void {
    const situation = msg.clientSituation ?? msg;
    // Store and refresh instructions on the next session update.
    // For now we keep it minimal and re-apply the existing persona.
    this.clientSituation = situation as ClientSituation;
    this.sendSessionUpdate();
  }

  private sendXai(payload: Record<string, unknown>): void {
    if (!this.xaiWs || this.xaiWs.readyState !== WebSocket.OPEN) return;
    this.xaiWs.send(JSON.stringify(payload));
  }

  private sendError(message: string): void {
    getLogger().error('XAI_VOICE', message);
    if (this.closed) return;
    this.transport.sendControl({ type: 'error', sessionId: this.sessionId, message });
    this.setState('error');
  }
}
