import { Agent, ConfigManager, TelegramBridge, TelegramStore, DiscordBridge, DiscordStore, SlackBridge, SlackStore, EmailBridge, PluginRegistry, CrewManager, SessionStore, ProviderFactory } from '@agentx/engine';
import { getLogger, generateSessionId, VERSION, authManager } from '@agentx/shared';
import type { AgentXConfig, EngineEvent } from '@agentx/shared';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

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

function getWebApiPidPath(): string {
  return join(getDataDir(), 'webapi.pid');
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

export function getDaemonStatus(): { running: boolean; pid?: number; crew?: string; telegram?: boolean; botUsername?: string; discord?: boolean; discordUsername?: string; startedAt?: string; version?: string; setupMode?: boolean; locked?: boolean } {
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
    // Also stop web-api immediately (in case daemon is hung)
    stopWebApi();
    // Clean up
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
    return true;
  } catch {
    // Daemon may already be dead — still clean up files and web-api
    stopWebApi();
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
    return false;
  }
}

function writeStatus(status: Record<string, unknown>): void {
  const statusPath = getStatusPath();
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

/**
 * Best-effort start of the web API server.
 * Tries multiple candidate paths to locate the web-api package.
 */
async function startWebApiIfAvailable(): Promise<void> {
  // Check if already running
  try {
    const res = await fetch('http://127.0.0.1:3333/api/health', { method: 'GET' });
    if (res.ok) return;
  } catch { /* not running */ }

  // Clean up stale PID file before spawning a new instance
  const webApiPidPath = getWebApiPidPath();
  if (existsSync(webApiPidPath)) {
    try {
      const stalePid = parseInt(readFileSync(webApiPidPath, 'utf-8').trim(), 10);
      try { process.kill(stalePid, 0); } catch { /* dead */ unlinkSync(webApiPidPath); }
    } catch { /* ignore */ }
  }

  const bundlePath = new URL(import.meta.url).pathname;
  const bundleDir = dirname(bundlePath);

  const candidates: string[] = [];
  const add = (p?: string | null) => { if (p) candidates.push(p); };

  // 1. Installed bundle sibling
  add(join(bundleDir, 'web-api'));

  // 2. Walk up from bundle
  let bcur = bundleDir;
  for (let i = 0; i < 6; i++) {
    add(join(bcur, 'packages', 'web-api'));
    add(join(bcur, 'source', 'packages', 'web-api'));
    add(join(bcur, 'web-api'));
    const next = dirname(bcur);
    if (!next || next === bcur) break;
    bcur = next;
  }

  // 3. CWD-based candidates
  add(join(process.cwd(), 'packages', 'web-api'));
  add(join(process.cwd(), 'source', 'packages', 'web-api'));

  // 4. Environment overrides
  if (process.env['AGENTX_SOURCE']) add(join(process.env['AGENTX_SOURCE'], 'packages', 'web-api'));
  if (process.env['AGENTX_HOME']) add(join(process.env['AGENTX_HOME'], 'web-api'));

  // 5. Walk up from CWD
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    add(join(cur, 'packages', 'web-api'));
    add(join(cur, 'source', 'packages', 'web-api'));
    add(join(cur, 'web-api'));
    const next = dirname(cur);
    if (!next || next === cur) break;
    cur = next;
  }

  let webApiDir: string | undefined;
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'dist', 'index.js')) || existsSync(join(dir, 'server.js'))) {
      webApiDir = dir;
      break;
    }
  }
  if (!webApiDir) {
    console.error('⚠ Daemon: Web API not found. Searched:');
    for (const dir of candidates) console.error(`   ${dir}`);
    return;
  }

  const builtScript = join(webApiDir, 'dist', 'index.js');
  const serverScript = join(webApiDir, 'server.js');
  const sourceScript = join(webApiDir, 'src', 'index.ts');

  let script: string | undefined;
  if (existsSync(builtScript)) script = builtScript;
  else if (existsSync(serverScript)) script = serverScript;
  else if (existsSync(sourceScript)) script = sourceScript;

  if (!script) {
    console.error('⚠ Daemon: Web API directory found but no runnable script.');
    return;
  }

  try {
    const args = script === sourceScript
      ? [join(webApiDir, 'node_modules', '.bin', 'tsx'), script]
      : [process.execPath, script];
    const child = spawn(args[0]!, args.slice(1), {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENTX_AUTO_STARTED: '1', AGENTX_DAEMON_HANDLES_TG: '1' },
    });
    child.on('error', (err) => {
      console.error(`⚠ Daemon: Failed to spawn web-api: ${err.message}`);
    });
    // Persist web-api PID so we can shut it down gracefully later
    if (child.pid) {
      try {
        mkdirSync(getDataDir(), { recursive: true });
        writeFileSync(getWebApiPidPath(), String(child.pid));
      } catch {
        // non-critical
      }
    }
    child.unref();
  } catch (err) {
    console.error(`⚠ Daemon: startWebApiIfAvailable error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Gracefully stop the web API server.
 * Sends SIGTERM, blocks up to 3s polling, then SIGKILL if still alive.
 * Cleans up the PID file regardless.
 */
export function stopWebApi(): void {
  const pidPath = getWebApiPidPath();
  if (!existsSync(pidPath)) return;

  let pid: number;
  try {
    pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
  } catch {
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    return;
  }

  // Try SIGTERM first
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already dead or permission denied — clean up and bail
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    return;
  }

  // Synchronous poll for up to 3 seconds
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // still alive
    } catch {
      // Process is dead — clean up and exit
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      return;
    }
    // 50ms busy-wait (acceptable for shutdown path)
    const waitUntil = Date.now() + 50;
    while (Date.now() < waitUntil) { /* spin */ }
  }

  // Timeout — force kill
  try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  try { unlinkSync(pidPath); } catch { /* ignore */ }
}

/**
 * Keep the web API alive. Runs an initial start and then checks every 30s.
 */
function maintainWebApi(): void {
  // Initial attempt
  startWebApiIfAvailable().catch(() => {});
  // Periodic health check / restart
  setInterval(() => {
    startWebApiIfAvailable().catch(() => {});
  }, 30_000);
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
  const isConfigured = configManager.isConfigured();

  // Ensure web API is running and keep it alive (non-blocking, best-effort)
  maintainWebApi();

  // Write PID file
  const pidPath = getPidPath();
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(pidPath, String(process.pid));

  logger.info('DAEMON', `Starting Agent-X daemon (PID: ${process.pid})`);

  // If not configured yet, run in "setup mode" or "locked mode"
  if (!isConfigured) {
    const hasAuth = authManager.hasRootUser();

    if (hasAuth) {
      // Auth exists but config is encrypted (locked) — user needs to log in via web-ui
      console.log('✦ Agent-X daemon started in secure mode.');
      console.log('');
      console.log('  Config is encrypted. Log in via Web-UI to unlock.');
      console.log('  Web-UI: http://localhost:3333');
      console.log('');

      writeStatus({
        pid: process.pid,
        crew: 'Default',
        telegram: false,
        startedAt: new Date().toISOString(),
        version: VERSION,
        setupMode: false,
        locked: true,
      });
    } else {
      // No auth, no config — first-time setup
      console.log('✦ Agent-X daemon started in setup mode.');
      console.log('');
      console.log('  Complete setup at: http://localhost:3333');
      console.log('');
      console.log('  Or run `agentx` for the interactive terminal setup.');

      writeStatus({
        pid: process.pid,
        crew: 'Default',
        telegram: false,
        startedAt: new Date().toISOString(),
        version: VERSION,
        setupMode: true,
      });
    }

    // Keep daemon alive in setup/locked mode
    const setupShutdown = () => {
      stopWebApi();
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
      process.exit(0);
    };
    process.on('SIGTERM', setupShutdown);
    process.on('SIGINT', setupShutdown);

    // Heartbeat to keep status fresh
    setInterval(() => {
      if (hasAuth) {
        writeStatus({
          pid: process.pid,
          crew: 'Default',
          telegram: false,
          startedAt: new Date().toISOString(),
          version: VERSION,
          setupMode: false,
          locked: true,
        });
      } else {
        writeStatus({
          pid: process.pid,
          crew: 'Default',
          telegram: false,
          startedAt: new Date().toISOString(),
          version: VERSION,
          setupMode: true,
        });
      }
    }, 30_000);

    return; // Stay running; event loop keeps process alive
  }

  const config: AgentXConfig = configManager.load();

  // Load telegram config
  const telegramStore = new TelegramStore();
  const telegramConfig = telegramStore.load();

  // Load discord config
  const discordStore = new DiscordStore();
  const discordConfig = discordStore.load();

  // Load slack config
  const slackStore = new SlackStore();
  const slackConfig = slackStore.load();

  // Load email config from plugin registry
  const pluginRegistry = new PluginRegistry();
  const emailPlugin = pluginRegistry.getPlugin('email');
  const emailConfig = emailPlugin?.enabled ? (emailPlugin.config as Record<string, unknown> | undefined) : undefined;

  if (!telegramConfig?.botToken && !discordConfig?.botToken && !slackConfig?.botToken && !emailConfig?.['smtpHost']) {
    console.log('✦ Agent-X daemon started.');
    console.log('');
    console.log('  Telegram not connected.');
    console.log('  Discord not connected.');
    console.log('  Slack not connected.');
    console.log('  To connect, run: agentx start --token <your-bot-token>');
    console.log('');
    console.log('  Web-UI: http://localhost:3333');
  } else {
    if (!telegramConfig?.botToken) {
      console.log('  Telegram not connected.');
      console.log('  To connect, run: agentx start --token <your-bot-token>');
    }
    if (!discordConfig?.botToken) {
      console.log('  Discord not connected.');
    }
    if (!slackConfig?.botToken) {
      console.log('  Slack not connected.');
    }
  }

  // Get active crew member
  const pm = new CrewManager();
  const activeCrew = pm.getActive();

  logger.info('DAEMON', `Crew: ${activeCrew.name}`);

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

  // Start Telegram bridge only if configured
  let bridge: TelegramBridge | null = null;
  if (telegramConfig?.botToken) {
    bridge = new TelegramBridge({ botToken: telegramConfig.botToken });
    bridge.attach(agent);
  }

  // Start Discord bridge only if configured
  let discordBridge: DiscordBridge | null = null;
  if (discordConfig?.botToken) {
    discordBridge = new DiscordBridge();
    discordBridge.setAgentFactory(async (userId: string) => {
      const userSessionId = generateSessionId();
      const userAgent = new Agent({
        config,
        sessionId: userSessionId,
      });
      // Create session record
      try {
        sessionStore.createSession({
          id: userSessionId,
          title: `Discord Session ${userId}`,
          status: 'active',
          provider: config.provider.activeProvider,
          model: config.provider.activeModel,
          scopePath: process.cwd(),
          tokenAvailable: userAgent.tokens.tokensTotal,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch { /* session may already exist */ }
      return userAgent;
    });
  }

  // Start Slack bridge only if configured
  let slackBridge: SlackBridge | null = null;
  if (slackConfig?.botToken && slackConfig?.appToken) {
    slackBridge = new SlackBridge(slackConfig);
    slackBridge.setAgentFactory((userId) => {
      const userSessionId = `${sessionId}-slack-${userId}`;
      const userAgent = new Agent({
        config,
        sessionId: userSessionId,
        systemPrompt: activeCrew.systemPrompt,
      });
      try {
        sessionStore.createSession({
          id: userSessionId,
          title: `Slack Session ${userId}`,
          status: 'active',
          provider: config.provider.activeProvider,
          model: config.provider.activeModel,
          scopePath: process.cwd(),
          tokenAvailable: userAgent.tokens.tokensTotal,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch { /* session may already exist */ }
      return userAgent;
    });
  }

  // Start Email bridge only if configured
  let emailBridge: EmailBridge | null = null;
  if (emailConfig?.['smtpHost']) {
    try {
      emailBridge = new EmailBridge();
      emailBridge.setAgentDeps({
        config,
        systemPrompt: activeCrew.systemPrompt,
      });
      await emailBridge.start({
        smtpHost: String(emailConfig['smtpHost']),
        smtpPort: Number(emailConfig['smtpPort'] ?? 587),
        smtpUser: String(emailConfig['smtpUser']),
        smtpPass: String(emailConfig['smtpPass']),
        fromAddress: String(emailConfig['fromAddress'] ?? emailConfig['smtpUser']),
        imapHost: emailConfig['imapHost'] ? String(emailConfig['imapHost']) : undefined,
        imapPort: emailConfig['imapPort'] ? Number(emailConfig['imapPort']) : undefined,
      });
      console.log('  Email bridge: connected');
    } catch (err) {
      console.error(`Failed to start Email bridge: ${err instanceof Error ? err.message : String(err)}`);
      emailBridge = null;
    }
  }

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
        if (item.chatId && response.content && bridge) {
          await bridge.sendToChat(item.chatId, response.content);
        }
      } catch (err) {
        // Report error to Telegram if possible
        if (item.chatId && bridge) {
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
    if (activeChatId && bridge) {
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
  if (bridge && toolExecutor?.setPermissionRequestHandler) {
    toolExecutor.setPermissionRequestHandler(
      async (toolId: string, path: string, riskLevel: string) => {
        // If no active chat, deny by default (guardrail)
        if (!activeChatId || !bridge) return 'deny' as const;

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
            if (activeChatId && bridge) {
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

  if (bridge) {
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
        bridge!.sendToChat(chatId, label).catch(() => {});
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
          await bridge!.sendToChat(chatId, `📥 Receiving file: ${fileName}...`);
          const fileBuffer = await bridge!.downloadFile(fileId);

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
          bridge!.sendToChat(chatId, `❌ Failed to receive file: ${errMsg}`).catch(() => {});
        }
      })();
    });

    // Set up Telegram command handler — full feature parity
    bridge.setCommandHandler(async (cmd, args, chatId) => {
      activeChatId = chatId;
      return handleTelegramCommand(cmd, args, { agent, pm, config, configManager, sessionStore, sessionId, bridge: bridge!, lastUserMessage: () => lastUserMessage });
    });

    // Route all user messages through the queue (no direct agent.sendMessage from bridge)
    bridge.setMessageHandler((text, chatId) => {
      activeChatId = chatId;
      lastUserMessage = text;
      enqueueMessage(text, chatId);
    });
  }

  if (bridge) {
    try {
      await bridge.start();
      const tgStatus = bridge.getStatus();
      logger.info('DAEMON', `Telegram connected: @${tgStatus.botUsername}`);
    } catch (err) {
      console.error(`Failed to start Telegram bridge: ${err instanceof Error ? err.message : String(err)}`);
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      process.exit(1);
    }
  }

  if (discordBridge) {
    try {
      await discordBridge.start(discordConfig!.botToken, discordConfig!.channelId);
      const dcStatus = discordBridge.getStatus();
      logger.info('DAEMON', `Discord connected: ${dcStatus.botUsername ?? 'unknown'}`);
    } catch (err) {
      console.error(`Failed to start Discord bridge: ${err instanceof Error ? err.message : String(err)}`);
      // Don't exit — Discord failure is non-fatal
    }
  }

  if (slackBridge) {
    try {
      await slackBridge.start();
      const slStatus = slackBridge.getStatus();
      logger.info('DAEMON', `Slack connected: ${slStatus.team ?? 'unknown'}`);
    } catch (err) {
      console.error(`Failed to start Slack bridge: ${err instanceof Error ? err.message : String(err)}`);
      // Don't exit — Slack failure is non-fatal
    }
  }

  // Write status and console output
  const tgStatus = bridge?.getStatus();
  const dcStatus = discordBridge?.getStatus();
  const slStatus = slackBridge?.getStatus();
  const emStatus = emailBridge?.getStatus();
  writeStatus({
    pid: process.pid,
    crew: activeCrew.name,
    crewId: activeCrew.id,
    telegram: tgStatus?.connected ?? false,
    botUsername: tgStatus?.botUsername,
    discord: dcStatus?.connected ?? false,
    discordUsername: dcStatus?.botUsername,
    slack: slStatus?.connected ?? false,
    slackTeam: slStatus?.team,
    email: emStatus?.connected ?? false,
    emailConfigured: emStatus?.configured ?? false,
    startedAt: new Date().toISOString(),
    sessionId,
    version: VERSION,
  });

  console.log(`✦ Agent-X daemon started (PID: ${process.pid})`);
  console.log(`  Crew: ${activeCrew.name}`);
  console.log(`  Telegram: ${tgStatus?.connected ? `@${tgStatus.botUsername}` : 'not connected'}`);
  console.log(`  Discord: ${dcStatus?.connected ? dcStatus.botUsername : 'not connected'}`);
  console.log(`  Slack: ${slStatus?.connected ? slStatus.team : 'not connected'}`);
  console.log(`  Email: ${emStatus?.connected ? 'connected' : 'not connected'}`);
  console.log('  Web-UI: http://localhost:3333');

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
        if (activeChatId && bridge) {
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
    stopWebApi();
    if (bridge) bridge.stop();
    if (discordBridge) discordBridge.stop();
    if (slackBridge) slackBridge.stop();
    if (emailBridge) emailBridge.stop();
    agent.endSession();
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Heartbeat — keep status up to date
  setInterval(() => {
    let tgConnected = false;
    let tgBotUsername: string | undefined;
    let tgMessageCount = 0;
    if (bridge) {
      const status = bridge.getStatus();
      tgConnected = status.connected;
      tgBotUsername = status.botUsername;
      tgMessageCount = status.messageCount;
    }
    let dcConnected = false;
    let dcBotUsername: string | undefined;
    let dcMessageCount = 0;
    if (discordBridge) {
      const status = discordBridge.getStatus();
      dcConnected = status.connected;
      dcBotUsername = status.botUsername;
      dcMessageCount = status.messageCount;
    }
    let slConnected = false;
    let slTeam: string | undefined;
    if (slackBridge) {
      const status = slackBridge.getStatus();
      slConnected = status.connected;
      slTeam = status.team;
    }
    let emConnected = false;
    let emConfigured = false;
    if (emailBridge) {
      const status = emailBridge.getStatus();
      emConnected = status.connected;
      emConfigured = status.configured;
    }
    writeStatus({
      pid: process.pid,
      crew: pm.getActive().name,
      crewId: pm.getActive().id,
      telegram: tgConnected,
      botUsername: tgBotUsername,
      messageCount: tgMessageCount,
      discord: dcConnected,
      discordUsername: dcBotUsername,
      discordMessageCount: dcMessageCount,
      slack: slConnected,
      slackTeam: slTeam,
      email: emConnected,
      emailConfigured: emConfigured,
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
  pm: CrewManager;
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

    // ─── Crew management ───
    case 'crews':
    case 'crew': {
      const sub = args[0];
      if (!sub || sub === 'list') {
        const crews = pm.list().filter((p) => !p.isDefault);
        const activeId = pm.getActiveId();
        const lines = crews.map((p) => `${p.id === activeId ? '● ' : '○ '}${p.name}`);
        return `📋 Crew:\n${lines.join('\n')}\n\nUse /crew switch <name> to change`;
      }
      if (sub === 'switch') {
        const name = args.slice(1).join(' ');
        if (!name) return '❌ Usage: /crew switch <name>';
        const crews = pm.list();
        const target = crews.find((p) => p.name.toLowerCase() === name.toLowerCase() || p.id === name);
        if (!target) return `❌ Crew "${name}" not found. Use /crew list`;
        pm.switch(target.id);
        // Rebuild system prompt with the new crew member's persona
        agent.rebuildSystemPrompt();
        agent.clearHistory();
        return `✅ Switched to crew: ${target.name}\nConversation reset with new persona.`;
      }
      if (sub === 'current') {
        return `📌 Current crew: ${pm.getActive().name}`;
      }
      return '📋 Crew commands:\n/crew list\n/crew switch <name>\n/crew current';
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
        `├ Crew: ${pm.getActive().name}`,
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
        '📋 Crew:',
        '  /crew list — List crews',
        '  /crew switch <name> — Switch crew member',
        '  /crew current — Show current',
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
