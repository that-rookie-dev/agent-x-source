import { randomUUID } from 'node:crypto';
import type { ChannelPlugin } from '../types.js';
import type { FocusState, FocusManager } from '../FocusManager.js';
import { getDataDir, type Message, type VisualUpdate, type AgentXConfig, getLogger } from '@agentx/shared';
import { TelegramBridge } from '../../telegram/TelegramBridge.js';
import { TelegramProgressSession } from '../../telegram/TelegramProgressSession.js';
import type { TelegramConfig } from '../../telegram/TelegramBridge.js';
import type { Agent } from '../../agent/Agent.js';
import { syncChannelSuperSessionContext } from '../../channels/channel-super-session-sync.js';
import { ProviderFactory } from '../../providers/index.js';
import { mkdirSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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
  private pendingPermissions = new Map<string, (choice: 'allow_once' | 'allow_always' | 'deny') => void>();
  private permRequesters = new Map<string, number>();
  private pendingResponses = new Map<string, (text: string) => void>();
  private messageQueue: Array<{ text: string; chatId: number }> = [];
  private static readonly MAX_QUEUE_DEPTH = 25;
  private processingQueue = false;
  private filesDir: string;

  constructor(config: TelegramConfig) {
    this.bridge = new TelegramBridge(config);
    this.filesDir = process.env['AGENTX_FILES_DIR']
      ?? join(getDataDir(), 'files');
  }

  setAgent(agent: Agent): void {
    this.agent = agent;
    this.bridge.attach(agent);
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
    this.pendingPermissions.clear();
    this.pendingResponses.clear();
    this.messageQueue = [];
    this.processingQueue = false;
  }

  private setupHandlers(): void {
    this.setupPermissionHandling();
    this.setupFileHandling();
    this.setupCommandHandling();
    this.setupMessageHandling();
    this.setupCallbackHandlers();
  }

  private setupCallbackHandlers(): void {
    // Profile selection via inline keyboard
    this.bridge.onCallback('profile', (data: string, chatId: number) => {
      const profileId = data.split(':').slice(1).join(':');
      if (!this.agent) {
        void this.bridge.sendToChat(chatId, '⚠️ Agent not initialized.');
        return;
      }
      const cfg = (this.agent as any).config as AgentXConfig;
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
      this.agent.switchProvider(foundProviderId as any, pCfg.profiles?.[profileId]?.apiKey ?? pCfg.apiKey, pCfg.profiles?.[profileId]?.baseUrl ?? pCfg.baseUrl);
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

    toolExecutor.setChannelPermissionRequestHandler(
      async (toolId: string, path: string, riskLevel: string, context?: { args?: Record<string, unknown>; integrationPreview?: import('@agentx/shared').IntegrationActionPreview }) => {
        if (!this.activeChatId) return 'deny' as const;

        const permId = randomUUID();
        const requesterId = this.activeChatId ? this.bridge.getLastFromId(this.activeChatId) : undefined;
        if (requesterId) this.permRequesters.set(permId, requesterId);
        const riskEmoji = riskLevel === 'high' ? '🔴' : riskLevel === 'medium' ? '🟡' : '🟢';
        const preview = context?.integrationPreview;
        const previewLines = preview
          ? [
            '',
            `*${preview.summary}*`,
            preview.impact,
            ...preview.parameters.filter((p) => !p.sensitive).slice(0, 4).map((p) => `• ${p.key}: ${p.value.slice(0, 80)}`),
          ].join('\n')
          : '';

        await this.bridge.sendWithButtons(
          this.activeChatId,
          `${riskEmoji} *Permission Request*\n\nTool: \`${toolId}\`\nPath: \`${path}\`\nRisk: ${riskLevel}${previewLines}\n\nAllow this action?`,
          [
            { text: '✅ Allow Once', callbackData: `perm:${permId}:allow_once` },
            { text: '✅ Always Allow', callbackData: `perm:${permId}:allow_always` },
            { text: '❌ Deny', callbackData: `perm:${permId}:deny` },
          ],
        );

        return new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
          const timeout = setTimeout(() => {
            this.pendingPermissions.delete(permId);
            this.permRequesters.delete(permId);
            if (this.activeChatId) {
              this.bridge.sendToChat(this.activeChatId, '⏰ Permission request timed out — denied.');
            }
            resolve('deny');
          }, 120_000);

          this.pendingPermissions.set(permId, (choice: 'allow_once' | 'allow_always' | 'deny') => {
            clearTimeout(timeout);
            this.pendingPermissions.delete(permId);
            this.permRequesters.delete(permId);
            if (this.agent && choice !== 'allow_once') {
              this.agent.recordToolPermissionDecision(toolId, choice);
            }
            resolve(choice);
          });
        });
      },
    );

    this.bridge.onCallback('perm', (data: string, chatId: number, fromUserId?: number) => {
      if (chatId !== this.activeChatId) return;
      const parts = data.split(':');
      const permId = parts[1];
      const choice = parts[2] as 'allow_once' | 'allow_always' | 'deny';
      if (!permId || !choice) return;

      const expectedRequester = this.permRequesters.get(permId);
      if (expectedRequester && fromUserId && fromUserId !== expectedRequester) {
        void this.bridge.sendToChat(chatId, '⚠️ Only the user who triggered this action can approve it.');
        return;
      }

      const resolver = this.pendingPermissions.get(permId);
      if (resolver) {
        this.permRequesters.delete(permId);
        resolver(choice);
        const label = choice === 'allow_once' ? '✅ Allowed (once)' : choice === 'allow_always' ? '✅ Always allowed' : '❌ Denied';
        this.bridge.sendToChat(chatId, label);
      }
    });
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
          await this.bridge.sendToChat(chatId, `📥 Receiving file: ${fileName}...`);
          const fileBuffer = await this.bridge.downloadFile(fileId);

          const timestamp = Date.now();
          const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const savedPath = join(this.filesDir, `${timestamp}_${safeName}`);
          await writeFile(savedPath, fileBuffer);

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

  private setupCommandHandling(): void {
    this.bridge.setCommandHandler(async (cmd: string, args: string[], chatId: number) => {
      this.trackActiveChat(chatId);
      this.focusManager?.onActivity('telegram');
      return this.handleCommand(cmd, args, chatId);
    });
  }

  private setupMessageHandling(): void {
    this.bridge.setMessageHandler((text: string, chatId: number) => {
      getLogger().info('TELEGRAM', `Inbound message chat=${chatId} len=${text.length}`);
      try {
        this.trackActiveChat(chatId);
        this.focusManager?.onActivity('telegram');
      } catch (e) {
        getLogger().warn('TELEGRAM', `Inbound setup skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.enqueueMessage(text, chatId);
    });
  }

  private enqueueMessage(text: string, chatId: number): void {
    if (this.messageQueue.length >= TelegramChannelPlugin.MAX_QUEUE_DEPTH) {
      void this.bridge.sendToChat(chatId, '⚠️ Too many pending messages. Please wait for the current request to finish.');
      return;
    }
    this.messageQueue.push({ text, chatId });
    void this.processQueue().catch((e) => {
      getLogger().error('TELEGRAM', `Inbound queue failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  private async dispatchInbound(item: { text: string; chatId: number }, attempt = 0): Promise<Message> {
    if (!this.agent) throw new Error('Channel agent not attached');
    try {
      return await Promise.race([
        this.agent.sendMessage(item.text, { sourceChannel: 'telegram', channelId: String(item.chatId) }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Response timed out after 2 minutes')), 120_000);
        }),
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const stuckRun = /already has an active run|already processing/i.test(errMsg);
      if (stuckRun && attempt < 1) {
        getLogger().warn('TELEGRAM', `Channel agent busy — cancelling stale run and retrying chat=${item.chatId}`);
        this.agent.cancel();
        return this.dispatchInbound(item, attempt + 1);
      }
      throw err;
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
        getLogger().info('TELEGRAM', `Processing inbound chat=${item.chatId} agent=${this.agent?.currentSessionId ?? 'unknown'}`);
        const progress = new TelegramProgressSession(this.bridge, item.chatId, this.agent);
        await progress.start();
        try {
          const response = await this.dispatchInbound(item);
          const text = typeof response.content === 'string' ? response.content.trim() : '';
          getLogger().info('TELEGRAM', `Reply ready chat=${item.chatId} len=${text.length}`);
          if (text) {
            await this.bridge.sendToChat(item.chatId, text);
          } else {
            await this.bridge.sendToChat(item.chatId, '_(No response generated)_');
          }
        } catch (err) {
          let errMsg = err instanceof Error ? err.message : String(err);
          getLogger().warn('TELEGRAM', `Reply failed chat=${item.chatId}: ${errMsg}`);
          const jsonMatch = errMsg.match(/"message"\s*:\s*"([^"]+)"/);
          if (jsonMatch?.[1]) errMsg = jsonMatch[1];
          if (errMsg.length > 400) errMsg = errMsg.slice(0, 400) + '...';
          await this.bridge.sendToChat(item.chatId, `⚠️ ${errMsg}`);
        } finally {
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

      case 'plan':
      case 'hyperdrive':
        return 'ℹ️ Plan Mode and Hyperdrive are not available on messaging channels. Every tool is approved individually via Allow Once, Always Allow, or Deny.';

      case 'profiles': {
        const cfg = (this.agent as any).config as AgentXConfig;
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
        const cfg = (this.agent as any).config as AgentXConfig;
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
        this.agent.switchProvider(foundProviderId as any, pCfg.profiles?.[profileId]?.apiKey ?? pCfg.apiKey, pCfg.profiles?.[profileId]?.baseUrl ?? pCfg.baseUrl);
        return `✅ Switched to profile: ${profileId} (${foundProviderId})\nUse /models to pick a model.`;
      }

      case 'models': {
        try {
          const cfg = (this.agent as any).config as AgentXConfig;
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
        const toolRegistry = (this.agent as any).toolRegistry;
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
          `├ Provider: ${(this.agent as any).config?.provider?.activeProvider ?? 'unknown'}`,
          `├ Model: ${(this.agent as any).config?.provider?.activeModel ?? 'unknown'}`,
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
        const cfg = (this.agent as any).config as AgentXConfig | undefined;
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
