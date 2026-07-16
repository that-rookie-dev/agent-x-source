import { randomUUID } from 'node:crypto';
import type { ChannelPlugin } from '../types.js';
import type { FocusState, FocusManager } from '../FocusManager.js';
import { getDataDir, type Message, type VisualUpdate, type ProviderId, getLogger, formatQuestionnaireForMessagingChannel, extractAssistantReplyText, questionnaireSupportsInlineButtons, type QuestionnairePayload, type QuestionnaireOption } from '@agentx/shared';
import { TelegramBridge } from '../../telegram/TelegramBridge.js';
import { TelegramProgressSession } from '../../telegram/TelegramProgressSession.js';
import type { TelegramConfig } from '../../telegram/TelegramBridge.js';
import type { Agent } from '../../agent/Agent.js';
import { syncChannelSuperSessionContext } from '../../channels/channel-super-session-sync.js';
import { resolveChannelInboundAgent } from '../../channels/channel-inbound-router.js';
import type { PermissionRequestHandler } from '../../tools/ToolExecutor.js';
import { MessagingPermissionCoordinator } from '../../channels/MessagingPermissionCoordinator.js';
import { QuestionnaireWizard } from '../../channels/QuestionnaireWizard.js';
import { ProviderFactory } from '../../providers/index.js';
import { VoiceService, convertWavToOggOpus, mergeVoiceConfig } from '../../voice/index.js';
import { mkdirSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class TelegramChannelPlugin implements ChannelPlugin {
  readonly id = 'telegram';
  readonly name = 'Telegram Bot';
  readonly version = '2.0.0';
  readonly description = 'Telegram messaging channel for Agent-X with full command support';

  private bridge: TelegramBridge;
  private agent: Agent | null = null;
  private focusManager: FocusManager | null = null;
  private activeChatId: number | null = null;
  /** Registered by web-api — uses the authenticated ConfigManager (with DEK). */
  private chatIdPersister: ((chatId: string) => void) | null = null;
  private lastPersistedChatId: string | null = null;

  setChatIdPersister(fn: ((chatId: string) => void) | null): void {
    this.chatIdPersister = fn;
  }

  private trackActiveChat(chatId: number): void {
    this.activeChatId = chatId;
    const id = String(chatId);
    if (this.lastPersistedChatId === id) return;
    this.lastPersistedChatId = id;
    if (!this.chatIdPersister) return;
    try {
      this.chatIdPersister(id);
    } catch (e) {
      getLogger().warn('TELEGRAM', `Chat id persist skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  private permissionCoordinator = new MessagingPermissionCoordinator();
  private channelPermissionHandler: PermissionRequestHandler | null = null;
  private pendingResponses = new Map<string, (text: string) => void>();
  private messageQueue: Array<{ text: string; chatId: number; voiceReply?: boolean; platformMessageId?: number }> = [];
  private static readonly MAX_QUEUE_DEPTH = 25;
  /** Base turn timeout — scheduling/automation turns need more than 2 minutes. */
  private static readonly TURN_TIMEOUT_MS = 300_000;
  /** Extend deadline while tools are actively running. */
  private static readonly TOOL_ACTIVITY_EXTENSION_MS = 120_000;
  private processingQueue = false;
  /** Chat id for the inbound turn currently being processed (permission UI fallback). */
  private processingChatId: number | null = null;
  private filesDir: string;
  /** Short-lived state for Telegram inline questionnaire buttons. */
  private pendingQuestionnaires = new Map<string, {
    wizard: QuestionnaireWizard;
    chatId: number;
    messageId?: number;
    selected: Set<number>;
  }>();

  constructor(config: TelegramConfig) {
    this.bridge = new TelegramBridge(config);
    this.filesDir = process.env['AGENTX_FILES_DIR']
      ?? join(getDataDir(), 'files');
  }

  setAgent(agent: Agent): void {
    this.agent = agent;
    this.bridge.attach(agent);
  }

  setAllowedUserIds(ids: number[]): void {
    this.bridge.setAllowedUserIds(ids);
  }

  getAllowedUserIds(): number[] {
    return this.bridge.getAllowedUserIds();
  }

  setOwnerClaimHandler(fn: ((userId: number, chatId: number) => void) | null): void {
    this.bridge.setOwnerClaimHandler(fn);
  }

  setFocusManager(fm: FocusManager): void {
    this.focusManager = fm;
  }

  async onLoad(): Promise<void> {}

  async onStart(): Promise<void> {
    if (!existsSync(this.filesDir)) {
      mkdirSync(this.filesDir, { recursive: true });
    }
    this.setupHandlers();
    await this.bridge.start();
    this.agent?.setTelegramConnected(true, this.getActiveChatId());
  }

  async onStop(): Promise<void> {
    this.bridge.stop();
    this.agent?.setTelegramConnected(false);
    this.pendingQuestionnaires.clear();
    this.pendingResponses.clear();
    this.pendingQuestionnaires.clear();
    this.messageQueue = [];
    this.processingQueue = false;
  }

  private setupHandlers(): void {
    this.setupPermissionHandling();
    this.setupFileHandling();
    this.setupCommandHandling();
    this.setupMessageHandling();
    this.setupCallbackHandlers();
    this.setupQuestionnaireCallbacks();
  }

  private setupQuestionnaireCallbacks(): void {
    this.bridge.onCallback('clar', (data: string, chatId: number) => {
      void this.handleQuestionnaireCallback(data, chatId);
    });
  }

  private buildChoiceButtonRows(
    options: QuestionnaireOption[],
    callbackForIndex: (index: number) => string,
    selected?: Set<number>,
  ): Array<Array<{ text: string; callbackData: string }>> {
    const rows: Array<Array<{ text: string; callbackData: string }>> = [];
    for (let i = 0; i < options.length; i += 2) {
      const row: Array<{ text: string; callbackData: string }> = [];
      for (let j = i; j < Math.min(i + 2, options.length); j++) {
        const opt = options[j]!;
        const prefix = selected?.has(j) ? '✅ ' : '';
        const star = !selected && opt.recommended ? '⭐ ' : '';
        row.push({
          text: `${prefix}${star}${opt.label}`.trim(),
          callbackData: callbackForIndex(j),
        });
      }
      rows.push(row);
    }
    return rows;
  }

  private permToolIds = new Map<string, string>();

  private async sendQuestionnaireToTelegram(chatId: number, payload: QuestionnairePayload): Promise<boolean> {
    if (!questionnaireSupportsInlineButtons(payload)) {
      return false;
    }

    const token = randomUUID().slice(0, 8);
    const wizard = new QuestionnaireWizard(payload);
    this.pendingQuestionnaires.set(token, {
      wizard,
      chatId,
      selected: new Set(),
    });
    await this.showQuestionnaireStep(chatId, token);
    return true;
  }

  private questionnaireStepPrompt(_token: string, q: QuestionnairePayload['questions'][number], wizard: QuestionnaireWizard): string {
    const header = wizard.totalQuestions > 1
      ? `*${wizard.currentIndex + 1}/${wizard.totalQuestions}* ${q.prompt}`
      : q.prompt;
    if (q.type === 'multi_choice') {
      return `${header}\n\nTap to toggle, then Submit. Or type your answer.`;
    }
    return q.allowCustom !== false ? `${header}\n\n_Or type a custom answer._` : header;
  }

  private async showQuestionnaireStep(chatId: number, token: string): Promise<void> {
    const pending = this.pendingQuestionnaires.get(token);
    if (!pending) return;
    const q = pending.wizard.currentQuestion;
    if (!q || (q.type !== 'single_choice' && q.type !== 'multi_choice')) return;

    const options = (q.options ?? []).filter((o) => !o.disabled);
    pending.selected = new Set();
    const prompt = this.questionnaireStepPrompt(token, q, pending.wizard);

    if (q.type === 'single_choice') {
      const rows = this.buildChoiceButtonRows(options, (idx) => `clar:pick:${token}:${idx}`);
      await this.bridge.sendWithButtonRows(chatId, prompt, rows);
      return;
    }

    const rows = this.buildChoiceButtonRows(options, (idx) => `clar:tog:${token}:${idx}`, new Set());
    rows.push([{ text: '✓ Submit', callbackData: `clar:sub:${token}` }]);
    const messageId = await this.bridge.sendWithButtonRows(chatId, prompt, rows);
    if (messageId) pending.messageId = messageId;
  }

  private async finishQuestionnaireWizard(
    token: string,
    chatId: number,
    agent: Agent,
  ): Promise<void> {
    const pending = this.pendingQuestionnaires.get(token);
    if (!pending) return;
    const answer = pending.wizard.formatFinalAnswer();
    this.pendingQuestionnaires.delete(token);
    if (answer && agent.respondToClarification(answer)) {
      getLogger().info('TELEGRAM', `Questionnaire completed chat=${chatId}`);
    }
  }

  private async handleQuestionnaireCallback(data: string, chatId: number): Promise<void> {
    const parts = data.split(':');
    if (parts[0] !== 'clar' || parts.length < 3) return;
    const action = parts[1];
    const token = parts[2]!;
    const pending = this.pendingQuestionnaires.get(token);
    if (!pending || pending.chatId !== chatId) return;

    const agent = resolveChannelInboundAgent('telegram', this.agent);
    if (!agent?.isAwaitingClarification()) {
      this.pendingQuestionnaires.delete(token);
      return;
    }

    const q = pending.wizard.currentQuestion;
    const options = (q?.options ?? []).filter((o) => !o.disabled);

    if (action === 'pick' && q?.type === 'single_choice') {
      const idx = parseInt(parts[3] ?? '', 10);
      const value = options[idx]?.value;
      if (!value) return;
      pending.wizard.recordSingleAnswer(String(value));
      if (pending.wizard.isComplete()) {
        await this.finishQuestionnaireWizard(token, chatId, agent);
      } else {
        await this.showQuestionnaireStep(chatId, token);
      }
      return;
    }

    if (action === 'tog' && q?.type === 'multi_choice') {
      const idx = parseInt(parts[3] ?? '', 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= options.length) return;
      if (pending.selected.has(idx)) pending.selected.delete(idx);
      else pending.selected.add(idx);
      if (pending.messageId) {
        const rows = this.buildChoiceButtonRows(options, (i) => `clar:tog:${token}:${i}`, pending.selected);
        rows.push([{
          text: pending.selected.size > 0 ? `✓ Submit (${pending.selected.size})` : '✓ Submit',
          callbackData: `clar:sub:${token}`,
        }]);
        const selectedLabels = [...pending.selected].map((i) => options[i]?.label).filter(Boolean).join(', ');
        const prompt = selectedLabels
          ? `${this.questionnaireStepPrompt(token, q, pending.wizard)}\n\nSelected: ${selectedLabels}`
          : this.questionnaireStepPrompt(token, q, pending.wizard);
        await this.bridge.editMessageButtonRows(chatId, pending.messageId, prompt, rows);
      }
      return;
    }

    if (action === 'sub' && q?.type === 'multi_choice') {
      const values = [...pending.selected].map((i) => options[i]?.value).filter(Boolean) as string[];
      if (values.length === 0) {
        await this.bridge.sendToChat(chatId, 'Select at least one option, or type your answer.');
        return;
      }
      pending.wizard.recordMultiAnswer(new Set(values));
      if (pending.wizard.isComplete()) {
        await this.finishQuestionnaireWizard(token, chatId, agent);
      } else {
        await this.showQuestionnaireStep(chatId, token);
      }
    }
  }

  private formatPermissionPromptText(details: {
    toolId: string;
    path: string;
    riskLevel: string;
    forAutomation?: boolean;
    integrationPreview?: import('@agentx/shared').IntegrationActionPreview;
  }): string {
    const riskEmoji = details.riskLevel === 'high' ? '🔴' : details.riskLevel === 'medium' ? '🟡' : '🟢';
    const preview = details.integrationPreview;
    const previewLines = preview
      ? [
        '',
        `*${preview.summary}*`,
        preview.impact,
        ...preview.parameters.filter((p) => !p.sensitive).slice(0, 4).map((p) => `• ${p.key}: ${p.value.slice(0, 80)}`),
      ].join('\n')
      : '';
    const automationNote = details.forAutomation
      ? '\n\nThis tool is required for a scheduled automation.'
      : '';
    return `${riskEmoji} *Permission Request*\n\nTool: \`${details.toolId}\`\nPath: \`${details.path}\`\nRisk: ${details.riskLevel}${previewLines}${automationNote}\n\nAllow this action, deny, or send a custom instruction?`;
  }

  private telegramUserKey(chatId: number): string | undefined {
    const fromId = this.bridge.getLastFromId(chatId);
    return fromId != null ? `${chatId}:${fromId}` : undefined;
  }

  private setupCallbackHandlers(): void {
    // Profile selection via inline keyboard
    this.bridge.onCallback('profile', (data: string, chatId: number) => {
      const profileId = data.split(':').slice(1).join(':');
      if (!this.agent) {
        void this.bridge.sendToChat(chatId, '⚠️ Agent not initialized.');
        return;
      }
      const cfg = this.agent.config;
      let foundProviderId: string | null = null;
      for (const [pid, pcfg] of Object.entries(cfg.provider.providers)) {
        if (pcfg.profiles?.[profileId]) { foundProviderId = pid; break; }
        if (pid + '-default' === profileId) { foundProviderId = pid; break; }
      }
      if (!foundProviderId) {
        void this.bridge.sendToChat(chatId, `❌ Profile not found.`);
        return;
      }
      const pCfg = cfg.provider.providers[foundProviderId];
      if (!pCfg) return;
      this.agent.switchProvider(foundProviderId as ProviderId, pCfg.profiles?.[profileId]?.apiKey ?? pCfg.apiKey, pCfg.profiles?.[profileId]?.baseUrl ?? pCfg.baseUrl);
      void this.bridge.sendToChat(chatId, `✅ Switched to ${profileId}\nUse /models to pick a model.`);
    });

    // Model selection via inline keyboard
    this.bridge.onCallback('model', (data: string, chatId: number) => {
      const modelId = data.split(':').slice(1).join(':');
      if (!this.agent) {
        void this.bridge.sendToChat(chatId, '⚠️ Agent not initialized.');
        return;
      }
      const agent = this.agent;
      void (async () => {
        try {
          const success = await agent.trialModel(modelId);
          if (success) {
            agent.switchModel(modelId);
            void this.bridge.sendToChat(chatId, `✅ Switched to model: ${modelId}`);
          } else {
            void this.bridge.sendToChat(chatId, `❌ Model validation failed.`);
          }
        } catch (err) {
          void this.bridge.sendToChat(chatId, `❌ ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    });
  }

  rewirePermissionHandling(): void {
    this.setupPermissionHandling();
  }

  private setupPermissionHandling(): void {
    if (!this.agent) return;
    const toolExecutor = this.agent.getToolExecutor();
    if (!toolExecutor?.setChannelPermissionRequestHandler) {
      getLogger().warn('TELEGRAM', 'Channel permission handler not wired — toolExecutor missing setChannelPermissionRequestHandler');
      return;
    }

    const activeChatId = () => this.activeChatId ?? this.processingChatId ?? undefined;

    this.channelPermissionHandler = this.permissionCoordinator.createHandler(
      async (permId, details) => {
        const chatId = activeChatId();
        if (!chatId) return;
        this.permToolIds.set(permId, details.toolId);
        await this.bridge.sendWithButtons(
          chatId,
          this.formatPermissionPromptText(details),
          [
            { text: '✅ Allow Once', callbackData: `perm:${permId}:allow_once` },
            { text: '✅ Always Allow', callbackData: `perm:${permId}:allow_always` },
            { text: '❌ Deny', callbackData: `perm:${permId}:deny` },
            { text: '✏️ Instruct', callbackData: `perm:${permId}:instruct` },
          ],
        );
      },
      () => {
        const chatId = activeChatId();
        return chatId != null ? this.telegramUserKey(chatId) : undefined;
      },
      async (userKey) => {
        const chatId = Number(userKey.split(':')[0]);
        if (Number.isFinite(chatId)) {
          await this.bridge.sendToChat(chatId, '✏️ Reply with your instruction for the agent (how to proceed instead).');
        }
      },
    );

    toolExecutor.setChannelPermissionRequestHandler(this.channelPermissionHandler);

    // When a permission prompt times out (user didn't respond in 120s), abort the
    // entire agent turn. This prevents the agent from continuing and firing more
    // permission prompts in a loop — which is the #1 source of prompt spam on channels.
    this.permissionCoordinator.onTimeout(() => {
      const chatId = activeChatId();
      if (this.agent?.processing) {
        getLogger().info('TELEGRAM', `Permission timed out — aborting active turn chat=${chatId ?? 'unknown'}`);
        this.agent.cancel();
        if (chatId != null) {
          void this.bridge.sendToChat(chatId, '⏱ Permission timed out — run stopped. Send a new message to resume.').catch(() => {});
        }
      }
    });

    this.bridge.onCallback('perm', (data: string, chatId: number, fromUserId?: number) => {
      const parts = data.split(':');
      const permId = parts[1];
      const action = parts[2];
      if (!permId || !action) return;

      const userKey = fromUserId != null ? `${chatId}:${fromUserId}` : undefined;

      if (action === 'instruct') {
        if (!userKey) return;
        void this.permissionCoordinator.beginInstruct(permId, userKey, async () => {
          await this.bridge.sendToChat(chatId, '✏️ Reply with your instruction for the agent (how to proceed instead).');
        });
        return;
      }

      const choice = action as 'allow_once' | 'allow_always' | 'deny';
      if (!this.permissionCoordinator.resolveDecision(permId, choice, userKey)) return;

      const toolId = this.permToolIds.get(permId);
      this.permToolIds.delete(permId);
      if (this.agent && toolId && choice !== 'allow_once') {
        this.agent.recordToolPermissionDecision(toolId, choice);
      }
      const label = choice === 'allow_once' ? '✅ Allowed (once)' : choice === 'allow_always' ? '✅ Always allowed' : '❌ Denied';
      void this.bridge.sendToChat(chatId, label);
    });
  }

  /** Route permission prompts on the channel super-session agent (__channel__). */
  private wireInboundAgentPermissions(agent: Agent): void {
    if (agent !== this.agent) return;
    const exec = agent.getToolExecutor();
    if (!exec || !this.channelPermissionHandler) return;
    exec.setChannelPermissionRequestHandler(this.channelPermissionHandler);
    exec.setMessagingPermissionMode(true);
  }

  private clearInboundAgentPermissions(agent: Agent): void {
    if (agent !== this.agent) return;
    agent.getToolExecutor()?.setMessagingPermissionMode(false);
  }

  private setupFileHandling(): void {
    this.bridge.setFileHandler((fileId: string, fileName: string, mimeType: string, caption: string | undefined, chatId: number) => {
      if (!this.agent) {
        void this.bridge.sendToChat(chatId, '⚠️ Agent-X is starting up. Please wait a moment and try again.');
        return;
      }
      this.trackActiveChat(chatId);

      void (async () => {
        try {
          const isVoiceNote = fileName === 'voice.ogg' || mimeType.startsWith('audio/ogg');
          await this.bridge.sendToChat(chatId, isVoiceNote ? '🎙️ Transcribing voice note…' : `📥 Receiving file: ${fileName}...`);
          const fileBuffer = await this.bridge.downloadFile(fileId);

          const timestamp = Date.now();
          const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const savedPath = join(this.filesDir, `${timestamp}_${safeName}`);
          await writeFile(savedPath, fileBuffer);

          if (isVoiceNote) {
            await this.handleVoiceNote(savedPath, caption, chatId);
            return;
          }

          const fileMsg = caption
            ? `[FILE_RECEIVED] The user sent a file: "${fileName}" (${mimeType}). Saved at: ${savedPath}. Caption: "${caption}". You can read and analyze this file.`
            : `[FILE_RECEIVED] The user sent a file: "${fileName}" (${mimeType}). Saved at: ${savedPath}. You can read and analyze this file.`;

          this.enqueueMessage(fileMsg, chatId);
        } catch (err) {
          let errMsg = err instanceof Error ? err.message : String(err);
          const jsonMatch = errMsg.match(/"message"\s*:\s*"([^"]+)"/);
          if (jsonMatch?.[1]) errMsg = jsonMatch[1];
          this.bridge.sendToChat(chatId, `❌ ${errMsg}`);
        }
      })();
    });
  }

  private async handleVoiceNote(savedPath: string, caption: string | undefined, chatId: number): Promise<void> {
    if (!this.agent) {
      await this.bridge.sendToChat(chatId, '⚠️ Agent-X is starting up. Please wait a moment and try again.');
      return;
    }

    const cfg = this.agent?.config;
    const voiceConfig = mergeVoiceConfig(cfg?.voice);
    if (!voiceConfig.enabled || voiceConfig.mode?.channels !== 'voice-notes') {
      await this.bridge.sendToChat(chatId, '⚠️ Voice notes are disabled. Enable Voice → Channels → Voice notes in Settings.');
      return;
    }

    try {
      const service = new VoiceService({ dataDir: getDataDir(), config: voiceConfig });
      const transcript = await service.transcribeAudioFile(savedPath);
      const text = transcript.text?.trim();
      if (!text) {
        await this.bridge.sendToChat(chatId, '⚠️ I could not clearly transcribe that voice note. Please try again.');
        return;
      }
      const prompt = caption?.trim()
        ? `${caption.trim()}\n\n[VOICE_TRANSCRIPT]\n${text}`
        : text;
      await this.bridge.sendToChat(chatId, `📝 ${text}`);
      this.enqueueMessage(prompt, chatId, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.bridge.sendToChat(chatId, `⚠️ Voice transcription failed: ${msg}`);
    }
  }

  private async sendVoiceReply(chatId: number, text: string): Promise<void> {
    if (!this.agent) {
      await this.bridge.sendToChat(chatId, text);
      return;
    }

    const cfg = this.agent?.config;
    const voiceConfig = mergeVoiceConfig(cfg?.voice);
    const outDir = join(getDataDir(), 'voice', 'tmp');
    await mkdir(outDir, { recursive: true });
    const wavPath = join(outDir, `telegram-reply-${Date.now()}.wav`);
    const oggPath = join(outDir, `telegram-reply-${Date.now()}.ogg`);

    try {
      const service = new VoiceService({ dataDir: getDataDir(), config: voiceConfig });
      await service.synthesizeText(text, wavPath);
      await convertWavToOggOpus(wavPath, oggPath, { voiceTempDir: outDir, timeoutMs: 120_000 });
      const result = await this.bridge.sendVoice(chatId, oggPath);
      if (!result.ok) {
        throw new Error(result.description ?? 'Telegram sendVoice failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      getLogger().warn('TELEGRAM', `Voice reply failed, falling back to text: ${msg}`);
      await this.bridge.sendToChat(chatId, text);
    }
  }

  private setupCommandHandling(): void {
    this.bridge.setCommandHandler(async (cmd: string, args: string[], chatId: number) => {
      this.trackActiveChat(chatId);
      this.focusManager?.onActivity('telegram');
      return this.handleCommand(cmd, args, chatId);
    });
  }

  private setupMessageHandling(): void {
    this.bridge.setMessageHandler((text: string, chatId: number, messageId?: number) => {
      getLogger().info('TELEGRAM', `Inbound message chat=${chatId} len=${text.length}${messageId != null ? ` msgId=${messageId}` : ''}`);
      try {
        this.trackActiveChat(chatId);
        this.focusManager?.onActivity('telegram');
      } catch (e) {
        getLogger().warn('TELEGRAM', `Inbound setup skipped: ${e instanceof Error ? e.message : String(e)}`);
      }

      // "stop" / "abort" / "cancel" as a plain text message cancels the active run.
      // This is in addition to the /cancel slash command — users on mobile often
      // type "stop" without the slash prefix.
      const trimmed = text.trim().toLowerCase();
      if ((trimmed === 'stop' || trimmed === 'abort' || trimmed === 'cancel') && this.agent?.processing) {
        getLogger().info('TELEGRAM', `Stop command received — cancelling active run chat=${chatId}`);
        this.agent.cancel();
        void this.bridge.sendToChat(chatId, '⏹ Stopped. Send a new message when you\'re ready.').catch(() => {});
        return;
      }

      const userKey = this.telegramUserKey(chatId);
      if (userKey && this.permissionCoordinator.isAwaitingInstruct(userKey)) {
        if (this.permissionCoordinator.consumeInstructText(userKey, text)) {
          void this.bridge.sendToChat(chatId, '✏️ Instruction sent to the agent.');
          return;
        }
      }

      // Clarification answers must resume the in-flight turn — not start a new sendMessage.
      const agent = resolveChannelInboundAgent('telegram', this.agent);
      if (agent?.isAwaitingClarification()) {
        const delivered = agent.respondToClarification(text);
        if (delivered) {
          getLogger().info('TELEGRAM', `Clarification answer delivered chat=${chatId}`);
          return;
        }
        getLogger().warn('TELEGRAM', `Clarification waiter stale chat=${chatId} — enqueueing as new message`);
      }

      this.enqueueMessage(text, chatId, false, messageId);
    });
  }

  private enqueueMessage(text: string, chatId: number, voiceReply = false, platformMessageId?: number): void {
    if (this.messageQueue.length >= TelegramChannelPlugin.MAX_QUEUE_DEPTH) {
      void this.bridge.sendToChat(chatId, '⚠️ Too many pending messages. Please wait for the current request to finish.');
      return;
    }
    this.messageQueue.push({ text, chatId, voiceReply, platformMessageId });
    void this.processQueue().catch((e) => {
      getLogger().error('TELEGRAM', `Inbound queue failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async dispatchInbound(
    item: { text: string; chatId: number; voiceReply?: boolean; platformMessageId?: number },
    agent: Agent,
    attempt = 0,
  ): Promise<Message> {
    if (!agent) throw new Error('Channel agent not attached');

    let deadline = Date.now() + TelegramChannelPlugin.TURN_TIMEOUT_MS;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let rejectRef: ((err: Error) => void) | null = null;

    const clearTurnTimeout = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    const scheduleTurnTimeout = () => {
      if (!rejectRef) return;
      clearTurnTimeout();
      const remaining = Math.max(1, deadline - Date.now());
      timeoutHandle = setTimeout(() => {
        rejectRef!(new Error('Response timed out after 5 minutes'));
      }, remaining);
    };

    const unsubActivity = agent.events.on((event) => {
      if (
        event.type === 'tool_executing'
        || event.type === 'tool_complete'
        || event.type === 'turn_heartbeat'
        || event.type === 'loading_start'
      ) {
        deadline = Math.max(deadline, Date.now() + TelegramChannelPlugin.TOOL_ACTIVITY_EXTENSION_MS);
        scheduleTurnTimeout();
      }
    });

    try {
      return await new Promise<Message>((resolve, reject) => {
        rejectRef = reject;
        scheduleTurnTimeout();
        void agent.sendMessage(item.text, {
          sourceChannel: 'telegram',
          channelId: String(item.chatId),
          sourceMessageId: item.platformMessageId != null ? String(item.platformMessageId) : undefined,
        })
          .then(resolve)
          .catch(reject);
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const stuckRun = /already has an active run|already processing/i.test(errMsg);
      if (stuckRun && attempt < 1) {
        getLogger().warn('TELEGRAM', `Channel agent busy — cancelling stale run and retrying chat=${item.chatId}`);
        agent.cancel();
        return this.dispatchInbound(item, agent, attempt + 1);
      }
      throw err;
    } finally {
      clearTurnTimeout();
      unsubActivity();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) {
      getLogger().info('TELEGRAM', `Queue busy — message queued (depth=${this.messageQueue.length})`);
      return;
    }
    if (!this.agent) {
      getLogger().warn('TELEGRAM', 'Inbound queue drained — channel agent not attached');
      // Drain queue with error responses — agent not initialized yet
      while (this.messageQueue.length > 0) {
        const item = this.messageQueue.shift()!;
        await this.bridge.sendToChat(item.chatId, '⚠️ Agent-X is starting up. Please wait a moment and try again.');
      }
      return;
    }
    this.processingQueue = true;

    try {
      // Workspace/crew sync must never block Telegram replies.
      void Promise.resolve()
        .then(() => syncChannelSuperSessionContext())
        .catch((e) => {
          getLogger().warn('TELEGRAM', `Context sync skipped: ${e instanceof Error ? e.message : String(e)}`);
        });
      this.rewirePermissionHandling();
      getLogger().info(
        'TELEGRAM',
        `Dequeuing ${this.messageQueue.length} message(s) agent=${this.agent.currentSessionId ?? 'unknown'} processing=${this.agent.processing}`,
      );
      while (this.messageQueue.length > 0) {
        const item = this.messageQueue.shift()!;
        const agent = this.agent;
        if (!agent) {
          await this.bridge.sendToChat(item.chatId, '⚠️ Agent-X is starting up. Please wait a moment and try again.');
          continue;
        }
        getLogger().info(
          'TELEGRAM',
          `Processing inbound chat=${item.chatId} agent=${agent.currentSessionId ?? 'unknown'}`,
        );
        this.trackActiveChat(item.chatId);
        this.processingChatId = item.chatId;
        this.wireInboundAgentPermissions(agent);
        const progress = new TelegramProgressSession(this.bridge, item.chatId, agent);
        await progress.start();
        const unsubClarification = agent.events.on((event) => {
          if (event.type === 'clarification_required') {
            void this.sendQuestionnaireToTelegram(item.chatId, event.questionnaire).then((sentUi) => {
              if (sentUi) return;
              const text = formatQuestionnaireForMessagingChannel(event.questionnaire);
              if (!text) return;
              void this.bridge.sendToChat(item.chatId, text).catch((e) => {
                getLogger().warn('TELEGRAM', `Clarification send failed: ${e instanceof Error ? e.message : String(e)}`);
              });
            }).catch((e) => {
              getLogger().warn('TELEGRAM', `Questionnaire UI failed: ${e instanceof Error ? e.message : String(e)}`);
            });
            return;
          }
          if (event.type === 'permission_required') {
            if (this.activeChatId == null) this.trackActiveChat(item.chatId);
            return;
          }
          if (event.type === 'message_received' && agent.isAwaitingClarification()) {
            const msg = event.message;
            const hasQuestionnaire = Array.isArray(msg.parts)
              && msg.parts.some((p) => (p as { type?: string }).type === 'questionnaire');
            const text = typeof msg.content === 'string' ? msg.content.trim() : '';
            if (!hasQuestionnaire && text) {
              void this.bridge.sendToChat(item.chatId, text).catch((e) => {
                getLogger().warn('TELEGRAM', `Open clarification send failed: ${e instanceof Error ? e.message : String(e)}`);
              });
            }
          }
        });
        try {
          const response = await this.dispatchInbound(item, agent);
          const text = extractAssistantReplyText(response);
          getLogger().info('TELEGRAM', `Reply ready chat=${item.chatId} len=${text.length}`);
          let replyMessageIds: number[] = [];
          if (text) {
            if (item.voiceReply) {
              await this.sendVoiceReply(item.chatId, text);
            } else {
              replyMessageIds = await this.bridge.sendToChat(item.chatId, text);
            }
          } else {
            replyMessageIds = await this.bridge.sendToChat(item.chatId, '_(No response generated)_');
          }
          // Persist the Telegram message_ids of the assistant reply so we can
          // delete them from Telegram when the conversation is cleared.
          if (replyMessageIds.length > 0 && response?.id) {
            try {
              const store = agent.sessionManager?.getStorageAdapter();
              store?.updateMessage?.(agent.sessionId, response.id, {
                platformMessageIds: replyMessageIds,
                platformChatId: item.chatId,
              });
            } catch { /* best-effort */ }
          }
        } catch (err) {
          let errMsg = err instanceof Error ? err.message : String(err);
          getLogger().warn('TELEGRAM', `Reply failed chat=${item.chatId}: ${errMsg}`);
          const jsonMatch = errMsg.match(/"message"\s*:\s*"([^"]+)"/);
          if (jsonMatch?.[1]) errMsg = jsonMatch[1];
          if (errMsg.length > 400) errMsg = errMsg.slice(0, 400) + '...';
          await this.bridge.sendToChat(item.chatId, `⚠️ ${errMsg}`);
        } finally {
          unsubClarification?.();
          this.clearInboundAgentPermissions(agent);
          this.processingChatId = null;
          await progress.stop();
        }
      }
    } catch (err) {
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.length > 400) errMsg = errMsg.slice(0, 400) + '...';
      while (this.messageQueue.length > 0) {
        const item = this.messageQueue.shift()!;
        await this.bridge.sendToChat(item.chatId, `⚠️ ${errMsg}`).catch(() => {});
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private async handleCommand(cmd: string, args: string[], _chatId: number): Promise<string | null> {
    if (!this.agent) return '❌ Agent not initialized.';

    switch (cmd) {
      case 'start':
        return null;

      case 'help':
        return [
          '🤖 *Agent-X Channel Commands:*',
          '',
          '🔐 *Permissions:*',
          '  /permissions — List allowed/denied tools',
          '  /permissions revoke <tool> — Revoke one tool',
          '  /permissions revoke-all — Revoke all remembered permissions',
          '',
          '🔌 *Profile:*',
          '  /profiles — List configured provider profiles',
          '  /profile <id> — Switch channel to a profile',
          '',
          '🧠 *Model:*',
          '  /models — List available models',
          '  /model <id> — Switch channel model',
          '',
          '💬 *Session:*',
          '  /clear — Clear conversation history',
          '  /cancel — Cancel current processing',
          '  /retry — Retry last message',
          '',
          '🧰 *Other:*',
          '  /remember <text> — Save to memory',
          '  /status — Show channel status',
          '  /help — Show this help',
          '',
          'Or just type a message to chat!',
        ].join('\n');

      case 'permissions': {
        if (!this.agent) return '❌ Agent not initialized.';
        const sub = args[0]?.toLowerCase() ?? 'list';
        if (sub === 'list' || sub === 'show') {
          return this.agent.formatChannelToolPermissions();
        }
        if (sub === 'revoke-all' || sub === 'revokeall') {
          return this.agent.revokeChannelToolPermissions(undefined, true);
        }
        if (sub === 'revoke') {
          const tool = args.slice(1).join(' ').trim();
          if (!tool) return '❌ Usage: /permissions revoke <tool-name>';
          return this.agent.revokeChannelToolPermissions([tool]);
        }
        return 'Usage: /permissions [list|revoke <tool>|revoke-all]';
      }

      case 'profiles': {
        const cfg = this.agent.config;
        const profiles: Array<{ id: string; label: string; providerId: string }> = [];
        Object.entries(cfg.provider.providers).forEach(([pid, pcfg]) => {
          if (pcfg.profiles) {
            Object.entries(pcfg.profiles).forEach(([profId, prof]) => {
              profiles.push({ id: profId, label: prof.label, providerId: pid });
            });
          } else if (pcfg.configured) {
            profiles.push({ id: pid + '-default', label: pid, providerId: pid });
          }
        });
        if (profiles.length === 0) return '🔌 No profiles configured.';
        const active = cfg.provider.activeProvider;
        const lines = profiles.map((p) => `${p.providerId === active ? '●' : '○'} ${p.label} (${p.providerId})`);
        void this.bridge.sendWithButtons(this.activeChatId ?? 0, `🔌 *Profiles:*\n${lines.join('\n')}`, profiles.map(p => ({ text: p.label, callbackData: `profile:${p.id}` })));
        return null; // handled via inline buttons
      }

      case 'profile': {
        const profileId = args[0];
        if (!profileId) return '❌ Usage: /profile <profile_id>\nUse /profiles to list available profiles.';
        const cfg = this.agent.config;
        let foundProviderId: string | null = null;
        for (const [pid, pcfg] of Object.entries(cfg.provider.providers)) {
          if (pcfg.profiles?.[profileId]) {
            foundProviderId = pid;
            break;
          }
          if (pid + '-default' === profileId) {
            foundProviderId = pid;
            break;
          }
        }
        if (!foundProviderId) return `❌ Profile "${profileId}" not found. Use /profiles to list.`;
        const pCfg = cfg.provider.providers[foundProviderId];
        if (!pCfg) return `❌ Provider "${foundProviderId}" not configured.`;
        this.agent.switchProvider(foundProviderId as ProviderId, pCfg.profiles?.[profileId]?.apiKey ?? pCfg.apiKey, pCfg.profiles?.[profileId]?.baseUrl ?? pCfg.baseUrl);
        return `✅ Switched to profile: ${profileId} (${foundProviderId})\nUse /models to pick a model.`;
      }

      case 'models': {
        try {
          const cfg = this.agent.config;
          const provider = ProviderFactory.create(
            cfg.provider.activeProvider,
            cfg.provider.providers[cfg.provider.activeProvider]?.apiKey,
            cfg.provider.providers[cfg.provider.activeProvider]?.baseUrl,
          );
          const models = await provider.listModels();
          const activeModel = cfg.provider.activeModel;
          const displayModels = models.slice(0, 24);
          void this.bridge.sendWithButtons(
            this.activeChatId ?? 0,
            `🧠 *Models* (${cfg.provider.activeProvider}) — tap to switch:`,
            displayModels.map((m: { id: string; name?: string }) => ({
              text: `${m.id === activeModel ? '● ' : ''}${m.name ?? m.id}`,
              callbackData: `model:${m.id}`,
            })),
          );
          if (models.length > 24) {
            void this.bridge.sendToChat(this.activeChatId ?? 0, `... and ${models.length - 24} more. Use /model <id> for any model.`);
          }
          return null;
        } catch (err) {
          return `❌ ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case 'model': {
        const modelId = args[0];
        if (!modelId) return '❌ Usage: /model <model_id>\nUse /models to list.';
        try {
          const success = await this.agent.trialModel(modelId);
          if (success) {
            this.agent.switchModel(modelId);
            return `✅ Switched to model: ${modelId}`;
          }
          return `❌ Model "${modelId}" failed validation.`;
        } catch (err) {
          return `❌ ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case 'remember': {
        const text = args.join(' ');
        if (!text) return '❌ Usage: /remember <something to remember>';
        this.agent.sauce.recordMemory(text, 'user');
        return `✅ Remembered: "${text}"`;
      }

      case 'tools': {
        const toolRegistry = this.agent.getToolExecutor()?.getRegistry();
        if (!toolRegistry) return '🔧 No tools available.';
        const tools = toolRegistry.list();
        const categories = new Map<string, string[]>();
        for (const t of tools) {
          const cat = t.category ?? 'other';
          if (!categories.has(cat)) categories.set(cat, []);
          categories.get(cat)!.push(t.id);
        }
        const lines: string[] = [`🔧 *Tools* (${tools.length} total):`];
        for (const [cat, ids] of categories) {
          lines.push(`\n*${cat}:* ${ids.join(', ')}`);
        }
        return lines.join('\n');
      }

      case 'cancel':
        if (this.agent.processing) {
          this.agent.cancel();
          return '⏹ Cancelled current processing.';
        }
        return '✓ Nothing is processing.';

      case 'clear':
        this.agent.clearHistory();
        return '🗑 Conversation history cleared.';

      case 'retry': {
        if (this.agent.processing) return '⏳ Agent is still processing. Use /cancel first.';
        void this.agent.sendMessage('[RETRY_LAST]').catch(() => {});
        return '🔄 Retrying last message...';
      }

      case 'status': {
        const tokens = this.agent.tokens;
        return [
          '📊 *Agent-X Status*',
          `├ Provider: ${this.agent.config?.provider?.activeProvider ?? 'unknown'}`,
          `├ Model: ${this.agent.config?.provider?.activeModel ?? 'unknown'}`,
          `├ Tokens: ${tokens.tokensUsed} / ${tokens.tokensTotal}`,
          `├ Processing: ${this.agent.processing ? 'yes' : 'idle'}`,
          `└ Active Chat: ${this.activeChatId ?? 'none'}`,
        ].join('\n');
      }

      case 'focus':
        return `🎯 Current focus is on *Telegram*. Use Web-UI or Desktop to switch focus.`;

      case 'timezone':
      case 'tz': {
        const newTz = args.join(' ').trim();
        const cfg = this.agent.config;
        if (!cfg) return '❌ Agent config not available.';
        if (!newTz) {
          const currentTz = cfg.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
          const now = new Date().toLocaleString('en-US', { timeZone: currentTz, dateStyle: 'full', timeStyle: 'long' });
          return `🕐 *Timezone:* ${currentTz}\n📅 *Current time:* ${now}\n\nUse /timezone <IANA zone> to change.`;
        }
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: newTz }).format(new Date());
        } catch {
          return `❌ Invalid timezone: "${newTz}"`;
        }
        cfg.timezone = newTz;
        this.agent.rebuildSystemPrompt();
        const now = new Date().toLocaleString('en-US', { timeZone: newTz, dateStyle: 'full', timeStyle: 'long' });
        return `✅ Timezone set to: ${newTz}\n📅 Current time: ${now}`;
      }

      default:
        return null;
    }
  }

  async handleIncoming(payload: Record<string, unknown>): Promise<{ text: string; userId: string; channelId: string }> {
    const text = (payload['text'] as string) || '';
    const userId = String(payload['from_id'] ?? payload['userId'] ?? 'unknown');
    const channelId = String(payload['chat_id'] ?? payload['channelId'] ?? userId);
    return { text, userId, channelId };
  }

  async handleOutgoing(text: string, _metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chatId = this.activeChatId;
    if (chatId) {
      await this.bridge.sendToChat(chatId, text);
    }
    return { ok: true, text, chatId: String(chatId ?? '') };
  }

  async sendRaw(channelId: string, message: string): Promise<void> {
    const chatId = parseInt(channelId, 10) || this.activeChatId;
    if (chatId) {
      await this.bridge.sendToChat(chatId, message);
    }
  }

  async handleVisualUpdate(update: VisualUpdate): Promise<Record<string, unknown> | null> {
    switch (update.type) {
      case 'text_update':
        if (this.activeChatId) {
          await this.bridge.sendToChat(this.activeChatId, update.unstableText);
        }
        return { type: 'text', content: update.unstableText };
      case 'tool_card':
        return {
          type: 'tool',
          name: update.card.name,
          status: update.card.status,
          icon: update.card.icon,
        };
      case 'compaction_toast':
        return { type: 'status', message: update.action === 'start' ? 'Compacting...' : 'Compacted' };
      case 'toast':
        return { type: 'error', message: update.message };
      default:
        return null;
    }
  }

  getFocusState(): FocusState {
    return this.activeChatId ? 'focused' : 'background';
  }

  isHealthy(): boolean {
    return this.bridge.isRunning();
  }

  getActiveChatId(): number | null {
    return this.activeChatId;
  }

  getBridge(): TelegramBridge {
    return this.bridge;
  }
}
