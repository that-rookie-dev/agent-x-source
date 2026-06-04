import { Agent, ConfigManager, Gateway, TelegramStore, TelegramChannelPlugin, DiscordBridge, DiscordStore, SlackBridge, SlackStore, EmailBridge, PluginRegistry, CrewManager, SessionStore } from '@agentx/engine';
import { getLogger, generateSessionId, VERSION, authManager } from '@agentx/shared';
import type { AgentXConfig, EngineEvent } from '@agentx/shared';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

export function getDataDir(): string {
  return process.env['XDG_DATA_HOME']
    ? join(process.env['XDG_DATA_HOME'], 'agentx')
    : join(homedir(), '.local', 'share', 'agentx');
}

export const DAEMON_PORT = parseInt(process.env['AGENTX_PORT'] ?? '3333', 10);
const DAEMON_API_URL = `http://127.0.0.1:${DAEMON_PORT}`;

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
    process.kill(pid, 0);
    return true;
  } catch {
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    return false;
  }
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  crew?: string;
  crewId?: string;
  telegram?: boolean;
  botUsername?: string;
  messageCount?: number;
  discord?: boolean;
  discordUsername?: string;
  discordMessageCount?: number;
  slack?: boolean;
  slackTeam?: string;
  email?: boolean;
  emailConfigured?: boolean;
  focusChannel?: string;
  channels?: Array<{ id: string; enabled: boolean; focusState?: string }>;
  startedAt?: string;
  version?: string;
  setupMode?: boolean;
  locked?: boolean;
}

export function getDaemonStatus(): DaemonStatus {
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
    stopWebApi();
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
    return true;
  } catch {
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

async function startWebApiIfAvailable(): Promise<void> {
  try {
    const res = await fetch(`${DAEMON_API_URL}/api/health`, { method: 'GET' });
    if (res.ok) return;
  } catch { /* not running */ }

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

  add(join(bundleDir, 'web-api'));
  let bcur = bundleDir;
  for (let i = 0; i < 6; i++) {
    add(join(bcur, 'packages', 'web-api'));
    add(join(bcur, 'source', 'packages', 'web-api'));
    add(join(bcur, 'web-api'));
    const next = dirname(bcur);
    if (!next || next === bcur) break;
    bcur = next;
  }
  add(join(process.cwd(), 'packages', 'web-api'));
  add(join(process.cwd(), 'source', 'packages', 'web-api'));
  if (process.env['AGENTX_SOURCE']) add(join(process.env['AGENTX_SOURCE'], 'packages', 'web-api'));
  if (process.env['AGENTX_HOME']) add(join(process.env['AGENTX_HOME'], 'web-api'));
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
      env: { ...process.env, AGENTX_AUTO_STARTED: '1', AGENTX_DAEMON_HANDLES_TG: '1', AGENTX_PORT: String(DAEMON_PORT) },
    });
    child.on('error', (err) => {
      console.error(`⚠ Daemon: Failed to spawn web-api: ${err.message}`);
    });
    if (child.pid) {
      try {
        mkdirSync(getDataDir(), { recursive: true });
        writeFileSync(getWebApiPidPath(), String(child.pid));
      } catch { /* non-critical */ }
    }
    child.unref();
  } catch (err) {
    console.error(`⚠ Daemon: startWebApiIfAvailable error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

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

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    try { unlinkSync(pidPath); } catch { /* ignore */ }
    return;
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      return;
    }
    const waitUntil = Date.now() + 50;
    while (Date.now() < waitUntil) { /* spin */ }
  }

  try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  try { unlinkSync(pidPath); } catch { /* ignore */ }
}

function maintainWebApi(): void {
  startWebApiIfAvailable().catch(() => {});
  setInterval(() => {
    startWebApiIfAvailable().catch(() => {});
  }, 30_000);
}

/**
 * Main daemon entry point.
 * Uses Gateway to manage all channel plugins with focus-based routing.
 */
export async function startDaemon(): Promise<void> {
  const logger = getLogger();

  const configManager = new ConfigManager();
  const isConfigured = configManager.isConfigured();

  maintainWebApi();

  const pidPath = getPidPath();
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(pidPath, String(process.pid));

  logger.info('DAEMON', `Starting Agent-X daemon (PID: ${process.pid})`);

  if (!isConfigured) {
    const hasAuth = authManager.hasRootUser();

    if (hasAuth) {
      console.log('✦ Agent-X daemon started in secure mode.');
      console.log('');
      console.log('  Config is encrypted. Log in via Web-UI to unlock.');
      console.log(`  Web-UI: http://localhost:${DAEMON_PORT}`);

      console.log('╰───');
      console.log(`  agentx daemon ready • pid ${process.pid}`);
      console.log('  Connect: agentx');
      console.log(`  Web-UI: http://localhost:${DAEMON_PORT}`);
      console.log('  Telegram: automatic');

      console.log(`  Complete setup at: http://localhost:${DAEMON_PORT}`);
      console.log('');
      console.log('  Or run `agentx` for the interactive terminal setup.');

      writeStatus({
        pid: process.pid,
        telegram: false,
        startedAt: new Date().toISOString(),
        version: VERSION,
        setupMode: true,
      });
    }

    const setupShutdown = () => {
      stopWebApi();
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      try { unlinkSync(getStatusPath()); } catch { /* ignore */ }
      process.exit(0);
    };
    process.on('SIGTERM', setupShutdown);
    process.on('SIGINT', setupShutdown);

    setInterval(() => {
      if (hasAuth) {
        writeStatus({
          pid: process.pid,
          telegram: false,
          startedAt: new Date().toISOString(),
          version: VERSION,
          setupMode: false,
          locked: true,
        });
      } else {
        writeStatus({
          pid: process.pid,
          telegram: false,
          startedAt: new Date().toISOString(),
          version: VERSION,
          setupMode: true,
        });
      }
    }, 30_000);

    return;
  }

  const config: AgentXConfig = configManager.load();

  const telegramStore = new TelegramStore();
  const telegramConfig = telegramStore.load();

  const discordStore = new DiscordStore();
  const discordConfig = discordStore.load();

  const slackStore = new SlackStore();
  const slackConfig = slackStore.load();

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
  console.log(`  Web-UI: http://localhost:${DAEMON_PORT}`);
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

  const pm = new CrewManager();
  const activeCrew = pm.getActive();

  logger.info('DAEMON', activeCrew ? `Crew: ${activeCrew.name}` : 'No crew configured');

  const sessionStore = new SessionStore();
  const sessionId = generateSessionId();

  const agent = new Agent({
    config,
    sessionId,
  });

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

  // ─── Create Gateway with FocusManager ───
  const gateway = new Gateway();
  gateway.attachAgent(agent);

  // Register and start Telegram channel plugin
  if (telegramConfig?.botToken) {
    const tgPlugin = gateway.registerTelegram(telegramConfig.botToken);
    tgPlugin.setAgent(agent);

    try {
      await gateway.startChannel('telegram');
      const bridge = gateway.getTelegramBridge();
      const tgStatus = bridge?.getStatus();
      if (tgStatus?.connected) {
        logger.info('DAEMON', `Telegram connected: @${tgStatus.botUsername}`);
      }

      // Telegram tools
      const toolExecutor = (agent as any).toolExecutor;
      if (toolExecutor?.registerHandler && bridge) {
        toolExecutor.registerHandler('telegram_send_message', async (args: Record<string, unknown>) => {
          const message = args['message'] as string;
          if (!message) {
            return { success: false, output: 'Missing required parameter: message', error: 'INVALID_ARGS' };
          }
          const chatId = tgPlugin.getActiveChatId();
          if (!chatId) {
            return { success: false, output: 'No active Telegram chat', error: 'NO_ACTIVE_CHAT' };
          }
          try {
            await bridge.sendMessage(chatId, message);
            return { success: true, output: 'Message sent via Telegram' };
          } catch (err) {
            return { success: false, output: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`, error: 'SEND_FAILED' };
          }
        });

        toolExecutor.registerHandler('telegram_send_file', async (args: Record<string, unknown>) => {
          const filePath = args['path'] as string;
          if (!filePath) {
            return { success: false, output: 'Missing required parameter: path', error: 'INVALID_ARGS' };
          }
          if (!existsSync(filePath)) {
            return { success: false, output: `File not found: ${filePath}`, error: 'FILE_NOT_FOUND' };
          }
          const caption = args['caption'] as string | undefined;
          const chatId = args['chat_id'] ? parseInt(args['chat_id'] as string, 10) : undefined;
          try {
            const result = await bridge.sendDocumentToChat(chatId ?? (tgPlugin as any).activeChatId ?? 0, filePath, caption);
            if (result.ok) {
              return { success: true, output: `File sent successfully: ${filePath}` };
            }
            return { success: false, output: `Telegram API error: ${result.description ?? 'Unknown error'}`, error: 'TELEGRAM_ERROR' };
          } catch (err) {
            return { success: false, output: `Failed to send file: ${err instanceof Error ? err.message : String(err)}`, error: 'SEND_FAILED' };
          }
        });
      }
    } catch (err) {
      console.error(`Failed to start Telegram bridge: ${err instanceof Error ? err.message : String(err)}`);
      try { unlinkSync(pidPath); } catch { /* ignore */ }
      process.exit(1);
    }
  }

  // ─── Discord bridge (standalone, not yet migrated to Gateway) ───
  let discordBridge: DiscordBridge | null = null;
  if (discordConfig?.botToken) {
    discordBridge = new DiscordBridge();
    discordBridge.setAgentFactory(async (userId: string) => {
      const userSessionId = generateSessionId();
      const userAgent = new Agent({ config, sessionId: userSessionId });
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

  // ─── Slack bridge (standalone, not yet migrated to Gateway) ───
  let slackBridge: SlackBridge | null = null;
  if (slackConfig?.botToken && slackConfig?.appToken) {
    slackBridge = new SlackBridge(slackConfig);
    slackBridge.setAgentFactory((userId) => {
      const userSessionId = `${sessionId}-slack-${userId}`;
      const userAgent = new Agent({ config, sessionId: userSessionId, systemPrompt: activeCrew?.systemPrompt });
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

  // ─── Email bridge (standalone, not yet migrated to Gateway) ───
  let emailBridge: EmailBridge | null = null;
  if (emailConfig?.['smtpHost']) {
    try {
      emailBridge = new EmailBridge();
      emailBridge.setAgentDeps({ config, systemPrompt: activeCrew?.systemPrompt });
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

  // ─── Scheduler reminder routing through Telegram ───
  agent.cron.setTriggerHandler((job) => {
    const bridge = gateway.getTelegramBridge();
    const tgPlugin = gateway.registry.getPlugin<TelegramChannelPlugin>('telegram');
    const chatId = tgPlugin?.getActiveChatId?.() ?? null;
    if (bridge && chatId) {
      const reminderMsg = job.oneShot
        ? `⏰ Reminder: ${job.instruction}`
        : `🔄 ${job.name}: ${job.instruction}`;
      bridge.sendToChat(chatId, reminderMsg).catch(() => {});
    }
  });

  // ─── Start bridges ───
  if (discordBridge) {
    try {
      await discordBridge.start(discordConfig!.botToken, discordConfig!.channelId);
      logger.info('DAEMON', `Discord connected: ${discordBridge.getStatus().botUsername ?? 'unknown'}`);
    } catch (err) {
      console.error(`Failed to start Discord bridge: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (slackBridge) {
    try {
      await slackBridge.start();
      logger.info('DAEMON', `Slack connected: ${slackBridge.getStatus().team ?? 'unknown'}`);
    } catch (err) {
      console.error(`Failed to start Slack bridge: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (emailBridge) {
    logger.info('DAEMON', 'Email bridge running');
  }

  // ─── Health check & reconnect for Telegram ───
  const RECONNECT_INTERVAL = 5 * 60 * 1000;
  const healthCheck = setInterval(async () => {
    const bridge = gateway.getTelegramBridge();
    if (!bridge) return;
    try {
      if (bridge.isRunning()) return;
      logger.info('DAEMON', 'Telegram disconnected — attempting reconnect...');
      await gateway.stopChannel('telegram');
      await gateway.startChannel('telegram');
    } catch (err) {
      logger.error('DAEMON', `Telegram reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, RECONNECT_INTERVAL);

  // ─── Status and console output ───
  const tgBridge = gateway.getTelegramBridge();
  const tgStatus = tgBridge?.getStatus();
  const dcStatus = discordBridge?.getStatus();
  const slStatus = slackBridge?.getStatus();
  const emStatus = emailBridge?.getStatus();
  writeStatus({
    pid: process.pid,
    ...(activeCrew ? { crew: activeCrew.name, crewId: activeCrew.id } : {}),
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
    focusChannel: gateway.focus.getFocus(),
  });

  console.log(`✦ Agent-X daemon started (PID: ${process.pid})`);
  console.log(activeCrew ? `  Crew: ${activeCrew.name}` : '  No crew configured');
  console.log(`  Telegram: ${tgStatus?.connected ? `@${tgStatus.botUsername}` : 'not connected'}`);
  console.log(`  Discord: ${dcStatus?.connected ? dcStatus.botUsername : 'not connected'}`);
  console.log(`  Slack: ${slStatus?.connected ? slStatus.team : 'not connected'}`);
  console.log(`  Email: ${emStatus?.connected ? 'connected' : 'not connected'}`);
  console.log('  Web-UI: http://localhost:3333');

  // ─── Subscribe to agent events ───
  agent.events.on((event: EngineEvent) => {
    switch (event.type) {
      case 'message_sent':
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
        {
          const focusedId = gateway.focus.getFocus();
          if (focusedId === 'telegram') {
            const bridge = gateway.getTelegramBridge();
            if (bridge) {
              bridge.sendToChat(0, `⚠️ Error: ${event.message}`).catch(() => {});
            }
          }
          logger.error('DAEMON', event.message);
        }
        break;
    }
  });

  // ─── Graceful shutdown ───
  const shutdown = () => {
    logger.info('DAEMON', 'Shutting down...');
    clearInterval(healthCheck);
    stopWebApi();
    void gateway.stopAll();
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

  // ─── Heartbeat ───
  setInterval(() => {
    const tgB = gateway.getTelegramBridge();
    let tgConnected = false;
    let tgBotUsername: string | undefined;
    let tgMessageCount = 0;
    if (tgB) {
      const s = tgB.getStatus();
      tgConnected = s.connected;
      tgBotUsername = s.botUsername;
      tgMessageCount = s.messageCount;
    }

    let dcConnected = false;
    let dcBotUsername: string | undefined;
    let dcMessageCount = 0;
    if (discordBridge) {
      const s = discordBridge.getStatus();
      dcConnected = s.connected;
      dcBotUsername = s.botUsername;
      dcMessageCount = s.messageCount;
    }

    let slConnected = false;
    let slTeam: string | undefined;
    if (slackBridge) {
      const s = slackBridge.getStatus();
      slConnected = s.connected;
      slTeam = s.team;
    }

    let emConnected = false;
    let emConfigured = false;
    if (emailBridge) {
      const s = emailBridge.getStatus();
      emConnected = s.connected;
      emConfigured = s.configured;
    }

    const channels = gateway.registry.listChannels().map((ch) => ({
      id: ch.id,
      enabled: ch.enabled,
      focusState: gateway.focus.getChannelState(ch.id),
    }));

    writeStatus({
      pid: process.pid,
      ...(() => { const c = pm.getActive(); return c ? { crew: c.name, crewId: c.id } : {}; })(),
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
      focusChannel: gateway.focus.getFocus(),
      channels,
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

// Daemon entry point
if (process.argv[1]?.endsWith('daemon.js') || process.argv.includes('--daemon')) {
  startDaemon().catch((err) => {
    console.error('Daemon failed:', err);
    process.exit(1);
  });
}
