import { Agent, ConfigManager, TelegramBridge, TelegramStore, ProfileManager, SessionStore, ProviderFactory } from '@agentx/engine';
import { getLogger, generateSessionId, VERSION } from '@agentx/shared';
import type { AgentXConfig, EngineEvent } from '@agentx/shared';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function getDataDir(): string {
  return process.env['XDG_DATA_HOME']
    ? join(process.env['XDG_DATA_HOME'], 'agentx')
    : join(homedir(), '.local', 'share', 'agentx');
}

function getPidPath(): string {
  return join(getDataDir(), 'daemon.pid');
}

function getStatusPath(): string {
  return join(getDataDir(), 'daemon.status');
}

export function isDaemonRunning(): boolean {
  const pidPath = getPidPath();
  if (!existsSync(pidPath)) return false;
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    // Check if process is alive
    process.kill(pid, 0);
    return true;
  } catch {
    // Process not running — stale PID file
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    return false;
  }
}

export function getDaemonStatus(): { running: boolean; pid?: number; profile?: string; telegram?: boolean; botUsername?: string; startedAt?: string; version?: string } {
  const statusPath = getStatusPath();
  if (!isDaemonRunning()) {
    return { running: false };
  }
  try {
    const data = JSON.parse(readFileSync(statusPath, 'utf-8'));
    return { running: true, ...data };
  } catch {
    const pidPath = getPidPath();
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    return { running: true, pid };
  }
}

export function stopDaemon(): boolean {
  const pidPath = getPidPath();
  if (!existsSync(pidPath)) return false;
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    process.kill(pid, 'SIGTERM');
    // Clean up
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
    return true;
  } catch {
    return false;
  }
}

function writeStatus(status: Record<string, unknown>): void {
  const statusPath = getStatusPath();
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

/**
 * Main daemon entry point.
 * Runs the agent in the background with Telegram as the primary interface.
 * Full feature parity with TUI: session persistence, all commands, permissions, error recovery.
 */
export async function startDaemon(): Promise<void> {
  const logger = getLogger();

  // Load config
  const configManager = new ConfigManager();
  if (!configManager.isConfigured()) {
    console.error('Agent-X is not configured. Run `agentx` first to set up.');
    process.exit(1);
  }

  const config: AgentXConfig = configManager.load();

  // Load telegram config
  const telegramStore = new TelegramStore();
  const telegramConfig = telegramStore.load();
  if (!telegramConfig?.botToken) {
    console.error('Telegram bot not configured. Run `agentx` and use /telegram start <token> first.');
    process.exit(1);
  }

  // Get active profile
  const pm = new ProfileManager();
  const activeProfile = pm.getActive();

  // Write PID file
  const pidPath = getPidPath();
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(pidPath, String(process.pid));

  logger.info('DAEMON', `Starting Agent-X daemon (PID: ${process.pid})`);
  logger.info('DAEMON', `Profile: ${activeProfile.name}`);

  // Session persistence — same as TUI
  const sessionStore = new SessionStore();
  const sessionId = generateSessionId();

  // Create the agent
  const agent = new Agent({
    config,
    sessionId,
  });

  // Create session record
  try {
    sessionStore.createSession({
      id: sessionId,
      title: `Daemon Session`,
      status: 'active',
      provider: config.provider.activeProvider,
      model: config.provider.activeModel,
      scopePath: process.cwd(),
      tokenAvailable: agent.tokens.tokensTotal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch { /* session may already exist */ }

  // Start Telegram bridge
  const bridge = new TelegramBridge({ botToken: telegramConfig.botToken });
  bridge.attach(agent);

  // Track the active chat ID for proactive messages (errors, etc.)
  let activeChatId: number | null = null;
  let lastUserMessage = '';

  // ─── Message Queue ───
  // All messages (user + scheduler) go through a queue to prevent race conditions.
  // Messages are processed one at a time — no concurrent sendMessage calls.
  const messageQueue: Array<{ text: string; chatId: number | null; isReminder?: boolean }> = [];
  let processingQueue = false;

  async function processQueue(): Promise<void> {
    if (processingQueue) return;
    processingQueue = true;

    while (messageQueue.length > 0) {
      const item = messageQueue.shift()!;
      try {
        const response = await agent.sendMessage(item.text);
        if (item.chatId && response.content) {
          await bridge.sendToChat(item.chatId, response.content);
        }
      } catch (err) {
        // Report error to Telegram if possible
        if (item.chatId) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await bridge.sendToChat(item.chatId, `⚠️ Error: ${errMsg}`).catch(() => {});
        }
        logger.error('DAEMON', `Queue processing error: ${err}`);
      }
    }

    processingQueue = false;
  }

  function enqueueMessage(text: string, chatId: number | null, isReminder = false): void {
    messageQueue.push({ text, chatId, isReminder });
    void processQueue();
  }

  // Override scheduler trigger to route reminders through Telegram via queue
  agent.cron.setTriggerHandler((job) => {
    if (activeChatId) {
      // Send the notification immediately (doesn't need LLM)
      const reminderMsg = job.oneShot
        ? `⏰ Reminder: ${job.instruction}`
        : `🔄 ${job.name}: ${job.instruction}`;
      bridge.sendToChat(activeChatId, reminderMsg).catch(() => {});
    }
    // Queue a conversational follow-up only for recurring jobs (skip for one-shots to save tokens)
    if (!job.oneShot && activeChatId) {
      enqueueMessage(`[SCHEDULED_TASK] ${job.instruction}`, activeChatId, true);
    }
  });

  // ─── Permission handling via Telegram ───
  // Instead of auto-approve, ask the user in Telegram and wait for response.
  const pendingPermissions = new Map<string, (choice: 'allow_once' | 'allow_always' | 'deny') => void>();

  const toolExecutor = (agent as any).toolExecutor;
  if (toolExecutor?.setPermissionRequestHandler) {
    toolExecutor.setPermissionRequestHandler(
      async (toolId: string, path: string, riskLevel: string) => {
        // If no active chat, deny by default (guardrail)
        if (!activeChatId) return 'deny' as const;

        const permId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const riskEmoji = riskLevel === 'high' ? '🔴' : riskLevel === 'medium' ? '🟡' : '🟢';

        // Send permission prompt with inline buttons
        await bridge.sendWithButtons(
          activeChatId,
          `${riskEmoji} *Permission Request*\n\nTool: \`${toolId}\`\nPath: \`${path}\`\nRisk: ${riskLevel}\n\nAllow this action?`,
          [
            { text: '✅ Allow Once', callbackData: `perm:${permId}:allow_once` },
            { text: '✅ Always Allow', callbackData: `perm:${permId}:allow_always` },
            { text: '❌ Deny', callbackData: `perm:${permId}:deny` },
          ],
        );

        // Wait for user response (timeout after 120s → deny)
        return new Promise<'allow_once' | 'allow_always' | 'deny'>((resolve) => {
          const timeout = setTimeout(() => {
            pendingPermissions.delete(permId);
            if (activeChatId) {
              bridge.sendToChat(activeChatId, '⏰ Permission request timed out — denied.').catch(() => {});
            }
            resolve('deny');
          }, 120_000);

          pendingPermissions.set(permId, (choice) => {
            clearTimeout(timeout);
            pendingPermissions.delete(permId);
            resolve(choice);
          });
        });
      },
    );
  }

  // Register callback handler for permission buttons
  bridge.onCallback('perm', (data, chatId) => {
    // Format: perm:<id>:<choice>
    const parts = data.split(':');
    const permId = parts[1];
    const choice = parts[2] as 'allow_once' | 'allow_always' | 'deny';
    if (!permId || !choice) return;

    const resolver = pendingPermissions.get(permId);
    if (resolver) {
      resolver(choice);
      const label = choice === 'allow_once' ? '✅ Allowed (once)' : choice === 'allow_always' ? '✅ Always allowed' : '❌ Denied';
      bridge.sendToChat(chatId, label).catch(() => {});
    }
  });

  // ─── Telegram file sending tool ───
  // Override the default no-op handler with the real implementation
  if (toolExecutor?.registerHandler) {
    toolExecutor.registerHandler('telegram_send_file', async (args: Record<string, unknown>) => {
      const filePath = args['path'] as string;
      if (!filePath) {
        return { success: false, output: 'Missing required parameter: path', error: 'INVALID_ARGS' };
      }
      if (!activeChatId) {
        return { success: false, output: 'No active Telegram chat. Send a message first.', error: 'NO_CHAT' };
      }
      // Verify file exists
      if (!existsSync(filePath)) {
        return { success: false, output: `File not found: ${filePath}`, error: 'FILE_NOT_FOUND' };
      }
      const caption = args['caption'] as string | undefined;
      try {
        const result = await bridge.sendDocumentToChat(activeChatId, filePath, caption);
        if (result.ok) {
          return { success: true, output: `File sent successfully: ${filePath}` };
        }
        return { success: false, output: `Telegram API error: ${result.description ?? 'Unknown error'}`, error: 'TELEGRAM_ERROR' };
      } catch (err) {
        return { success: false, output: `Failed to send file: ${err instanceof Error ? err.message : String(err)}`, error: 'SEND_FAILED' };
      }
    });
  }

  // ─── File receiving from Telegram ───
  // Downloads files sent by the user, saves to a dedicated folder, and informs the agent.
  const filesDir = join(getDataDir(), 'files');
  mkdirSync(filesDir, { recursive: true });

  bridge.setFileHandler((fileId, fileName, mimeType, caption, chatId) => {
    activeChatId = chatId;
    // Download and save asynchronously, then inform the agent
    void (async () => {
      try {
        await bridge.sendToChat(chatId, `📥 Receiving file: ${fileName}...`);
        const fileBuffer = await bridge.downloadFile(fileId);

        // Generate unique filename to avoid collisions
        const timestamp = Date.now();
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const savedPath = join(filesDir, `${timestamp}_${safeName}`);
        writeFileSync(savedPath, fileBuffer);

        // Inform the agent about the received file via the message queue
        const fileMsg = caption
          ? `[FILE_RECEIVED] The user sent a file: "${fileName}" (${mimeType}). Saved at: ${savedPath}. Caption: "${caption}". You can read and analyze this file.`
          : `[FILE_RECEIVED] The user sent a file: "${fileName}" (${mimeType}). Saved at: ${savedPath}. You can read and analyze this file.`;
        enqueueMessage(fileMsg, chatId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        bridge.sendToChat(chatId, `❌ Failed to receive file: ${errMsg}`).catch(() => {});
      }
    })();
  });

  // Set up Telegram command handler — full feature parity
  bridge.setCommandHandler(async (cmd, args, chatId) => {
    activeChatId = chatId;
    return handleTelegramCommand(cmd, args, { agent, pm, config, configManager, sessionStore, sessionId, bridge, lastUserMessage: () => lastUserMessage });
  });

  // Route all user messages through the queue (no direct agent.sendMessage from bridge)
  bridge.setMessageHandler((text, chatId) => {
    activeChatId = chatId;
    lastUserMessage = text;
    enqueueMessage(text, chatId);
  });

  try {
    await bridge.start();
    const status = bridge.getStatus();
    logger.info('DAEMON', `Telegram connected: @${status.botUsername}`);

    writeStatus({
      pid: process.pid,
      profile: activeProfile.name,
      profileId: activeProfile.id,
      telegram: true,
      botUsername: status.botUsername,
      startedAt: new Date().toISOString(),
      sessionId,
      version: VERSION,
    });

    console.log(`✦ Agent-X daemon started (PID: ${process.pid})`);
    console.log(`  Profile: ${activeProfile.name}`);
    console.log(`  Telegram: @${status.botUsername}`);
  } catch (err) {
    console.error(`Failed to start Telegram bridge: ${err instanceof Error ? err.message : String(err)}`);
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    process.exit(1);
  }

  // Subscribe to agent events — persist messages, handle errors
  agent.events.on((event: EngineEvent) => {
    switch (event.type) {
      case 'message_sent':
        // Persist user messages
        try {
          sessionStore.addMessage({
            id: event.message.id,
            sessionId: event.message.sessionId,
            role: event.message.role,
            content: event.message.content,
            tokenCount: event.message.tokenCount,
            createdAt: event.message.createdAt,
          });
        } catch { /* silent */ }
        break;

      case 'message_received':
        // Persist assistant messages
        try {
          sessionStore.addMessage({
            id: event.message.id,
            sessionId: event.message.sessionId,
            role: event.message.role,
            content: event.message.content,
            tokenCount: event.message.tokenCount,
            createdAt: event.message.createdAt,
          });
        } catch { /* silent */ }
        break;

      case 'error':
        // Report errors to Telegram
        if (activeChatId) {
          const errorMsg = `⚠️ Error: ${event.message}`;
          bridge.sendToChat(activeChatId, errorMsg).catch(() => {});
        }
        logger.error('DAEMON', event.message);
        break;
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('DAEMON', 'Shutting down...');
    bridge.stop();
    agent.endSession();
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Heartbeat — keep status up to date
  setInterval(() => {
    const status = bridge.getStatus();
    writeStatus({
      pid: process.pid,
      profile: pm.getActive().name,
      profileId: pm.getActive().id,
      telegram: status.connected,
      botUsername: status.botUsername,
      messageCount: status.messageCount,
      startedAt: readStatusStartTime(),
      sessionId,
      version: VERSION,
    });
  }, 30_000);
}

function readStatusStartTime(): string {
  try {
    const data = JSON.parse(readFileSync(getStatusPath(), 'utf-8'));
    return data.startedAt ?? new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

interface CommandContext {
  agent: Agent;
  pm: ProfileManager;
  config: AgentXConfig;
  configManager: ConfigManager;
  sessionStore: SessionStore;
  sessionId: string;
  bridge: TelegramBridge;
  lastUserMessage: () => string;
}

/**
 * Full Telegram command handler — feature parity with TUI slash commands.
 */
async function handleTelegramCommand(
  cmd: string,
  args: string[],
  ctx: CommandContext,
): Promise<string | null> {
  const { agent, pm, config, configManager, sessionStore, sessionId, bridge } = ctx;

  switch (cmd) {
    case 'start':
      return null; // Telegram's built-in /start — let agent handle

    // ─── Profile management ───
    case 'profiles':
    case 'profile': {
      const sub = args[0];
      if (!sub || sub === 'list') {
        const profiles = pm.list().filter((p) => !p.isDefault);
        const activeId = pm.getActiveId();
        const lines = profiles.map((p) => `${p.id === activeId ? '● ' : '○ '}${p.name}`);
        return `📋 Profiles:\n${lines.join('\n')}\n\nUse /profile switch <name> to change`;
      }
      if (sub === 'switch') {
        const name = args.slice(1).join(' ');
        if (!name) return '❌ Usage: /profile switch <name>';
        const profiles = pm.list();
        const target = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase() || p.id === name);
        if (!target) return `❌ Profile "${name}" not found. Use /profile list`;
        pm.switch(target.id);
        // Rebuild system prompt with the new profile's persona
        agent.rebuildSystemPrompt();
        agent.clearHistory();
        return `✅ Switched to profile: ${target.name}\nConversation reset with new persona.`;
      }
      if (sub === 'current') {
        return `📌 Current profile: ${pm.getActive().name}`;
      }
      return '📋 Profile commands:\n/profile list\n/profile switch <name>\n/profile current';
    }

    // ─── Model management ───
    case 'model': {
      const sub = args[0];
      if (!sub || sub === 'current') {
        return `🧠 Current model: ${config.provider.activeModel}\nProvider: ${config.provider.activeProvider}`;
      }
      if (sub === 'list') {
        try {
          const provider = ProviderFactory.create(
            config.provider.activeProvider,
            config.provider.providers[config.provider.activeProvider]?.apiKey,
            config.provider.providers[config.provider.activeProvider]?.baseUrl,
          );
          const models = await provider.listModels();
          const lines = models.slice(0, 20).map((m) =>
            `${m.id === config.provider.activeModel ? '● ' : '○ '}${m.name ?? m.id}`,
          );
          return `🧠 Models (${config.provider.activeProvider}):\n${lines.join('\n')}${models.length > 20 ? `\n... and ${models.length - 20} more` : ''}\n\nUse /model switch <id> to change`;
        } catch (err) {
          return `❌ Failed to list models: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      if (sub === 'switch') {
        const modelId = args.slice(1).join(' ');
        if (!modelId) return '❌ Usage: /model switch <model_id>';
        try {
          const success = await agent.trialModel(modelId);
          if (success) {
            agent.switchModel(modelId);
            const cur = configManager.load();
            cur.provider.activeModel = modelId;
            configManager.save(cur);
            return `✅ Switched to model: ${modelId}`;
          }
          return `❌ Model "${modelId}" failed validation. Try /model list to see available models.`;
        } catch (err) {
          return `❌ Failed to switch: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      return '🧠 Model commands:\n/model current\n/model list\n/model switch <id>';
    }

    // ─── Provider management ───
    case 'provider': {
      const sub = args[0];
      if (!sub || sub === 'current') {
        return `🔌 Provider: ${config.provider.activeProvider}\nModel: ${config.provider.activeModel}`;
      }
      if (sub === 'list') {
        const providers = ['openai', 'anthropic', 'google', 'ollama', 'lmstudio'];
        const lines = providers.map((p) => `${p === config.provider.activeProvider ? '● ' : '○ '}${p}`);
        return `🔌 Providers:\n${lines.join('\n')}\n\nUse /provider switch <name> to change`;
      }
      if (sub === 'switch') {
        const providerId = args[1];
        if (!providerId) return '❌ Usage: /provider switch <provider_id>';
        try {
          const cur = configManager.load();
          const providerConfig = cur.provider.providers[providerId];
          const key = providerConfig?.apiKey;
          const url = providerConfig?.baseUrl;
          agent.switchProvider(providerId as any, key, url);
          cur.provider.activeProvider = providerId as any;
          cur.provider.activeModel = '';
          configManager.save(cur);
          return `✅ Switched to provider: ${providerId}\nUse /model list to pick a model.`;
        } catch (err) {
          return `❌ Failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      return '🔌 Provider commands:\n/provider current\n/provider list\n/provider switch <id>';
    }

    // ─── Memory / Remember ───
    case 'remember': {
      const text = args.join(' ');
      if (!text) return '❌ Usage: /remember <something to remember>';
      agent.sauce.recordMemory(text, 'user');
      return `✅ Remembered: "${text}"`;
    }

    // ─── Tools ───
    case 'tools': {
      const toolRegistry = (agent as any).toolRegistry;
      if (!toolRegistry) return '🔧 No tools available.';
      const tools = toolRegistry.list();
      const categories = new Map<string, string[]>();
      for (const t of tools) {
        const cat = t.category ?? 'other';
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat)!.push(t.id);
      }
      const lines: string[] = [`🔧 Tools (${tools.length} total):`];
      for (const [cat, ids] of categories) {
        lines.push(`\n${cat}: ${ids.join(', ')}`);
      }
      return lines.join('\n');
    }

    // ─── Sessions ───
    case 'sessions': {
      const sub = args[0];
      if (sub === 'current') {
        return `📝 Current session: ${sessionId}`;
      }
      try {
        const sessions = sessionStore.listSessions?.() ?? [];
        if (sessions.length === 0) return '📝 No saved sessions.';
        const lines = sessions.slice(0, 10).map((s: any) =>
          `${s.id === sessionId ? '● ' : '○ '}${s.title ?? s.id} (${s.created_at ?? ''})`,
        );
        return `📝 Sessions:\n${lines.join('\n')}`;
      } catch {
        return `📝 Current session: ${sessionId}`;
      }
    }

    // ─── Cancel ───
    case 'cancel': {
      if (agent.processing) {
        agent.cancel();
        return '⏹ Cancelled current processing.';
      }
      return '✓ Nothing is processing.';
    }

    // ─── Clear history ───
    case 'clear': {
      agent.clearHistory();
      return '🗑 Conversation history cleared.';
    }

    // ─── Retry last message ───
    case 'retry': {
      const lastMsg = ctx.lastUserMessage();
      if (!lastMsg) return '❌ No previous message to retry.';
      if (agent.processing) return '⏳ Agent is still processing. Use /cancel first.';
      // Don't reply inline — let the agent respond through the normal flow
      void agent.sendMessage(lastMsg).catch(() => {});
      return '🔄 Retrying last message...';
    }

    // ─── Status ───
    case 'status': {
      const tokens = agent.tokens;
      const status = bridge.getStatus();
      return [
        '📊 Agent-X Daemon Status',
        `├ Profile: ${pm.getActive().name}`,
        `├ Provider: ${config.provider.activeProvider}`,
        `├ Model: ${config.provider.activeModel}`,
        `├ Session: ${sessionId}`,
        `├ Tokens: ${tokens.tokensUsed} / ${tokens.tokensTotal}`,
        `├ Messages: ${status.messageCount}`,
        `├ Processing: ${agent.processing ? 'yes' : 'idle'}`,
        `└ Uptime: running since PID ${process.pid}`,
      ].join('\n');
    }

    // ─── Help ───
    case 'help':
      return [
        '🤖 Agent-X Commands:',
        '',
        '📋 Profile:',
        '  /profile list — List profiles',
        '  /profile switch <name> — Switch profile',
        '  /profile current — Show current',
        '',
        '🧠 Model:',
        '  /model current — Show current model',
        '  /model list — List available models',
        '  /model switch <id> — Switch model',
        '',
        '🔌 Provider:',
        '  /provider current — Show provider',
        '  /provider list — List providers',
        '  /provider switch <id> — Switch provider',
        '',
        '💬 Session:',
        '  /clear — Clear conversation history',
        '  /cancel — Cancel current processing',
        '  /retry — Retry last message',
        '  /sessions — List sessions',
        '',
        '🧰 Other:',
        '  /remember <text> — Save to memory',
        '  /tools — List available tools',
        '  /timezone [tz] — View or set timezone',
        '  /status — Show daemon status',
        '',
        'Or just type a message to chat with the agent!',
      ].join('\n');

    // ─── Timezone ───
    case 'timezone':
    case 'tz': {
      const newTz = args.join(' ').trim();
      if (!newTz) {
        const currentTz = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date().toLocaleString('en-US', { timeZone: currentTz, dateStyle: 'full', timeStyle: 'long' });
        return `🕐 Timezone: ${currentTz}\n📅 Current time: ${now}\n\nUse /timezone <IANA timezone> to change.\nExample: /timezone Asia/Kolkata`;
      }
      // Validate timezone
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: newTz }).format(new Date());
      } catch {
        return `❌ Invalid timezone: "${newTz}"\n\nUse IANA format like: Asia/Kolkata, America/New_York, Europe/London, UTC`;
      }
      const cur = configManager.load();
      cur.timezone = newTz;
      configManager.save(cur);
      config.timezone = newTz;
      // Rebuild prompt so the agent knows the new timezone
      agent.rebuildSystemPrompt();
      const now = new Date().toLocaleString('en-US', { timeZone: newTz, dateStyle: 'full', timeStyle: 'long' });
      return `✅ Timezone set to: ${newTz}\n📅 Current time: ${now}`;
    }

    default:
      return null; // Unknown command — pass to agent
  }
}

// If this file is run directly as the daemon process
if (process.argv[1]?.endsWith('daemon.js') || process.argv.includes('--daemon')) {
  startDaemon().catch((err) => {
    console.error('Daemon failed:', err);
    process.exit(1);
  });
}
