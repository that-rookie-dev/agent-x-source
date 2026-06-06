import type { ChannelPlugin } from '../types.js';
import type { FocusState, FocusManager } from '../FocusManager.js';
import type { VisualUpdate } from '@agentx/shared';
import { TelegramBridge } from '../../telegram/TelegramBridge.js';
import type { TelegramConfig } from '../../telegram/TelegramBridge.js';
import type { Agent } from '../../agent/Agent.js';
import { CrewManager } from '../../secret-sauce/CrewManager.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ProviderFactory } from '../../providers/index.js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class TelegramChannelPlugin implements ChannelPlugin {
  readonly id = 'telegram';
  readonly name = 'Telegram Bot';
  readonly version = '2.0.0';
  readonly description = 'Telegram messaging channel for Agent-X with full command support';

  private bridge: TelegramBridge;
  private agent: Agent | null = null;
  private configManager: ConfigManager | null = null;
  private focusManager: FocusManager | null = null;
  private activeChatId: number | null = null;
  private pendingPermissions = new Map<string, (choice: 'allow_once' | 'allow_always' | 'deny') => void>();
  private pendingResponses = new Map<string, (text: string) => void>();
  private messageQueue: Array<{ text: string; chatId: number }> = [];
  private processingQueue = false;
  private filesDir: string;

  constructor(config: TelegramConfig) {
    this.bridge = new TelegramBridge(config);
    this.filesDir = process.env['AGENTX_FILES_DIR']
      ?? join(homedir(), '.local', 'share', 'agentx', 'files');
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
  }

  private setupHandlers(): void {
    this.setupPermissionHandling();
    this.setupFileHandling();
    this.setupCommandHandling();
    this.setupMessageHandling();
  }

  private setupPermissionHandling(): void {
    if (!this.agent) return;
    const toolExecutor = (this.agent as any).toolExecutor;
    if (!toolExecutor?.setPermissionRequestHandler) return;

    toolExecutor.setPermissionRequestHandler(
      async (toolId: string, path: string, riskLevel: string) => {
        if (!this.activeChatId) return 'deny' as const;

        const permId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const riskEmoji = riskLevel === 'high' ? '🔴' : riskLevel === 'medium' ? '🟡' : '🟢';

        await this.bridge.sendWithButtons(
          this.activeChatId,
          `${riskEmoji} *Permission Request*\n\nTool: \`${toolId}\`\nPath: \`${path}\`\nRisk: ${riskLevel}\n\nAllow this action?`,
          [
            { text: '✅ Allow Once', callbackData: `perm:${permId}:allow_once` },
            { text: '✅ Always Allow', callbackData: `perm:${permId}:allow_always` },
            { text: '❌ Deny', callbackData: `perm:${permId}:deny` },
          ],
        );

        return new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
          const timeout = setTimeout(() => {
            this.pendingPermissions.delete(permId);
            if (this.activeChatId) {
              this.bridge.sendToChat(this.activeChatId, '⏰ Permission request timed out — denied.');
            }
            resolve('deny');
          }, 120_000);

          this.pendingPermissions.set(permId, (choice: 'allow_once' | 'allow_always' | 'deny') => {
            clearTimeout(timeout);
            this.pendingPermissions.delete(permId);
            resolve(choice);
          });
        });
      },
    );

    this.bridge.onCallback('perm', (data: string, chatId: number) => {
      if (chatId !== this.activeChatId) return;
      const parts = data.split(':');
      const permId = parts[1];
      const choice = parts[2] as 'allow_once' | 'allow_always' | 'deny';
      if (!permId || !choice) return;

      const resolver = this.pendingPermissions.get(permId);
      if (resolver) {
        resolver(choice);
        const label = choice === 'allow_once' ? '✅ Allowed (once)' : choice === 'allow_always' ? '✅ Always allowed' : '❌ Denied';
        this.bridge.sendToChat(chatId, label);
      }
    });
  }

  private setupFileHandling(): void {
    this.bridge.setFileHandler((fileId: string, fileName: string, mimeType: string, caption: string | undefined, chatId: number) => {
      if (!this.agent) return;
      this.activeChatId = chatId;

      void (async () => {
        try {
          await this.bridge.sendToChat(chatId, `📥 Receiving file: ${fileName}...`);
          const fileBuffer = await this.bridge.downloadFile(fileId);

          const timestamp = Date.now();
          const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const savedPath = join(this.filesDir, `${timestamp}_${safeName}`);
          writeFileSync(savedPath, fileBuffer);

          const fileMsg = caption
            ? `[FILE_RECEIVED] The user sent a file: "${fileName}" (${mimeType}). Saved at: ${savedPath}. Caption: "${caption}". You can read and analyze this file.`
            : `[FILE_RECEIVED] The user sent a file: "${fileName}" (${mimeType}). Saved at: ${savedPath}. You can read and analyze this file.`;

          this.enqueueMessage(fileMsg, chatId);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.bridge.sendToChat(chatId, `❌ Failed to receive file: ${errMsg}`);
        }
      })();
    });
  }

  private setupCommandHandling(): void {
    this.bridge.setCommandHandler(async (cmd: string, args: string[], chatId: number) => {
      this.activeChatId = chatId;
      this.focusManager?.onActivity('telegram');
      return this.handleCommand(cmd, args, chatId);
    });
  }

  private setupMessageHandling(): void {
    this.bridge.setMessageHandler((text: string, chatId: number) => {
      this.activeChatId = chatId;
      this.focusManager?.onActivity('telegram');
      this.enqueueMessage(text, chatId);
    });
  }

  private enqueueMessage(text: string, chatId: number): void {
    this.messageQueue.push({ text, chatId });
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue || !this.agent) return;
    this.processingQueue = true;

    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift()!;
      try {
        const response = await this.agent.sendMessage(item.text);
        if (response.content) {
          await this.bridge.sendToChat(item.chatId, response.content);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.bridge.sendToChat(item.chatId, `⚠️ Error: ${errMsg}`);
      }
    }

    this.processingQueue = false;
  }

  private async handleCommand(cmd: string, args: string[], _chatId: number): Promise<string | null> {
    if (!this.agent) return '❌ Agent not initialized.';

    switch (cmd) {
      case 'start':
        return null;

      case 'help':
        return [
          '🤖 *Agent-X Commands:*',
          '',
          '📋 *Crew:*',
          '  /crew list — List crew members',
          '  /crew switch <name> — Switch crew member',
          '  /crew current — Show current crew',
          '',
          '🧠 *Model:*',
          '  /model current — Show current model',
          '  /model list — List available models',
          '  /model switch <id> — Switch model',
          '',
          '🔌 *Provider:*',
          '  /provider current — Show provider',
          '  /provider list — List providers',
          '  /provider switch <id> — Switch provider',
          '',
          '💬 *Session:*',
          '  /clear — Clear conversation history',
          '  /cancel — Cancel current processing',
          '  /retry — Retry last message',
          '',
          '🧰 *Other:*',
          '  /remember <text> — Save to memory',
          '  /tools — List available tools',
          '  /status — Show system status',
          '  /timezone [tz] — View/set timezone',
          '  /focus — Show current focus channel',
          '',
          'Or just type a message to chat!',
        ].join('\n');

      case 'crew': {
        const sub = args[0];
        const pm = new CrewManager();
        if (!sub || sub === 'list') {
          const crews = pm.list();
          if (crews.length === 0) return '📋 No crews configured.';
          const lines = crews.map((p) => `${p.enabled !== false ? '●' : '○'} ${p.name}`);
          return `📋 *Crew Members:*\n${lines.join('\n')}`;
        }
        return '📋 *Crew commands:*\n/crew list';
      }

      case 'model': {
        const sub = args[0];
        const configMgr = this.configManager ?? new ConfigManager();
        const cfg = configMgr.load();
        if (!sub || sub === 'current') {
          return `🧠 *Current Model:* ${cfg.provider.activeModel}\n*Provider:* ${cfg.provider.activeProvider}`;
        }
        if (sub === 'list') {
          try {
            const provider = ProviderFactory.create(
              cfg.provider.activeProvider,
              cfg.provider.providers[cfg.provider.activeProvider]?.apiKey,
              cfg.provider.providers[cfg.provider.activeProvider]?.baseUrl,
            );
            const models = await provider.listModels();
            const lines = models.slice(0, 20).map((m) =>
              `${m.id === cfg.provider.activeModel ? '● ' : '○ '}${m.name ?? m.id}`,
            );
            return `🧠 *Models* (${cfg.provider.activeProvider}):\n${lines.join('\n')}${models.length > 20 ? `\n... and ${models.length - 20} more` : ''}\n\nUse /model switch <id> to change`;
          } catch (err) {
            return `❌ Failed to list models: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        if (sub === 'switch') {
          const modelId = args.slice(1).join(' ');
          if (!modelId) return '❌ Usage: /model switch <model_id>';
          try {
            const success = await this.agent.trialModel(modelId);
            if (success) {
              this.agent.switchModel(modelId);
              const cur = configMgr.load();
              cur.provider.activeModel = modelId;
              configMgr.save(cur);
              return `✅ Switched to model: ${modelId}`;
            }
            return `❌ Model "${modelId}" failed validation.`;
          } catch (err) {
            return `❌ Failed to switch: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        return '🧠 *Model commands:*\n/model current\n/model list\n/model switch <id>';
      }

      case 'provider': {
        const sub = args[0];
        const configMgr = this.configManager ?? new ConfigManager();
        const cfg = configMgr.load();
        if (!sub || sub === 'current') {
          return `🔌 *Provider:* ${cfg.provider.activeProvider}\n*Model:* ${cfg.provider.activeModel}`;
        }
        if (sub === 'list') {
          const providers = ['openai', 'anthropic', 'google', 'ollama', 'lmstudio'];
          const lines = providers.map((p) => `${p === cfg.provider.activeProvider ? '● ' : '○ '}${p}`);
          return `🔌 *Providers:*\n${lines.join('\n')}\n\nUse /provider switch <name> to change`;
        }
        if (sub === 'switch') {
          const providerId = args[1];
          if (!providerId) return '❌ Usage: /provider switch <provider_id>';
          try {
            const cur = configMgr.load();
            const pConfig = cur.provider.providers[providerId];
            const key = pConfig?.apiKey;
            const url = pConfig?.baseUrl;
            this.agent.switchProvider(providerId as any, key, url);
            cur.provider.activeProvider = providerId as any;
            cur.provider.activeModel = '';
            configMgr.save(cur);
            return `✅ Switched to provider: ${providerId}\nUse /model list to pick a model.`;
          } catch (err) {
            return `❌ Failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        return '🔌 *Provider commands:*\n/provider current\n/provider list\n/provider switch <id>';
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
        return `🎯 Current focus is on *Telegram*. Use TUI or Web-UI to switch focus.`;

      case 'timezone':
      case 'tz': {
        const newTz = args.join(' ').trim();
        const configMgr = this.configManager ?? new ConfigManager();
        const cfg = configMgr.load();
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
        const cur = configMgr.load();
        cur.timezone = newTz;
        configMgr.save(cur);
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
