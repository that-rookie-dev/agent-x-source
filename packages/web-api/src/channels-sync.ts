import {
  Agent,
  DiscordBridge,
  Gateway,
  SlackBridge,
  getBuiltinPlugin,
} from '@agentx/engine';
import type { AgentXConfig, NotificationChannelsConfig, ProviderId, TelegramDiscoveredChat } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { ensureChannelAgent, getEngine } from './engine.js';

export interface TelegramDiscoverResult {
  ok: boolean;
  error?: string;
  botUsername?: string;
  botName?: string;
  chats?: TelegramDiscoveredChat[];
}

/** Validate bot token and list recent chats from getUpdates (user must message the bot first). */
export async function discoverTelegramBot(
  botToken: string,
  options?: { knownChatIds?: string[] },
): Promise<TelegramDiscoverResult> {
  const token = botToken.trim();
  if (!token) return { ok: false, error: 'Bot token is required' };

  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(12000) });
    const meJson = await meRes.json() as { ok?: boolean; description?: string; result?: { username?: string; first_name?: string } };
    if (!meJson.ok) {
      return { ok: false, error: meJson.description ?? 'Invalid bot token' };
    }

    const updatesRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=50`, { signal: AbortSignal.timeout(12000) });
    const updatesJson = await updatesRes.json() as {
      ok?: boolean;
      description?: string;
      result?: Array<{ message?: { chat?: { id?: number; title?: string; first_name?: string; username?: string; type?: string } } }>;
    };
    if (!updatesJson.ok) {
      return { ok: false, error: updatesJson.description ?? 'Failed to fetch updates' };
    }

    const chatMap = new Map<string, TelegramDiscoveredChat>();
    for (const update of updatesJson.result ?? []) {
      const chat = update.message?.chat;
      if (!chat?.id) continue;
      const id = String(chat.id);
      const title = chat.title
        ?? chat.first_name
        ?? (chat.username ? `@${chat.username}` : `Chat ${id}`);
      chatMap.set(id, { id, title, type: chat.type ?? 'unknown' });
    }

    for (const knownId of options?.knownChatIds ?? []) {
      const id = knownId.trim();
      if (!id || chatMap.has(id)) continue;
      chatMap.set(id, { id, title: `Chat ${id}`, type: 'known' });
    }

    return {
      ok: true,
      botUsername: meJson.result?.username,
      botName: meJson.result?.first_name,
      chats: [...chatMap.values()],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Telegram API request failed' };
  }
}

function channelEnabled(section: { enabled?: boolean } | undefined): boolean {
  return section?.enabled === true;
}

function wantsInbound(section: { inbound?: boolean; enabled?: boolean } | undefined): boolean {
  return channelEnabled(section) && section?.inbound !== false;
}

function wantsOutbound(section: { outbound?: boolean; enabled?: boolean } | undefined): boolean {
  return channelEnabled(section) && section?.outbound !== false;
}

export function isTelegramOutboundReady(ch?: NotificationChannelsConfig['telegram']): boolean {
  return wantsOutbound(ch) && Boolean(ch?.botToken && ch?.chatId);
}

export function isTelegramInboundReady(ch?: NotificationChannelsConfig['telegram']): boolean {
  return wantsInbound(ch) && Boolean(ch?.botToken);
}

/** Persist outbound chat target once the user has messaged the bot. */
export function saveTelegramChatId(chatId: string | number): void {
  const id = String(chatId).trim();
  if (!id) return;
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    if (cfg.channels?.telegram?.chatId === id) return;
    const next: AgentXConfig = {
      ...cfg,
      channels: {
        ...cfg.channels,
        telegram: {
          ...cfg.channels?.telegram,
          chatId: id,
        },
      },
    };
    eng.configManager.save(next);
    getLogger().info('CHANNELS', `Telegram outbound chat saved (${id})`);
  } catch (e) {
    getLogger().warn('CHANNELS', `Failed to save Telegram chat id: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function getTelegramRuntimeHints(): { telegramChatId?: string | null } {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const fromConfig = cfg.channels?.telegram?.chatId?.trim();
    if (fromConfig) return { telegramChatId: fromConfig };

    const gw = eng.gateway as {
      registry?: { getChannel?: (id: string) => { plugin?: { getActiveChatId?: () => number | null } } | null };
    } | null;
    const plugin = gw?.registry?.getChannel?.('telegram')?.plugin;
    const active = plugin?.getActiveChatId?.();
    if (active) return { telegramChatId: String(active) };
  } catch { /* engine may not be ready */ }
  return {};
}

async function startTelegramInbound(token: string): Promise<void> {
  const eng = getEngine();
  const existing = eng.pluginRegistry.getPlugin('telegram');
  if (existing) {
    eng.pluginRegistry.updateConfig('telegram', { botToken: token });
  } else {
    const entry = getBuiltinPlugin('telegram');
    if (entry) {
      eng.pluginRegistry.install(entry);
      eng.pluginRegistry.updateConfig('telegram', { botToken: token });
    }
  }
  eng.pluginRegistry.enable('telegram');

  if (eng.telegramBridge?.isRunning() || process.env['AGENTX_DAEMON_HANDLES_TG']) return;

  if (eng.gateway) {
    try { eng.gateway.stopChannel('telegram'); } catch { /* ignore */ }
  } else {
    eng.gateway = new Gateway();
  }

  const channelAgent = ensureChannelAgent();
  eng.gateway.attachAgent(channelAgent);
  const tgPlugin = eng.gateway.registerTelegram(token);
  tgPlugin.setAgent(channelAgent);
  await eng.gateway.startChannel('telegram');
  eng.telegramBridge = eng.gateway.getTelegramBridge();
  getLogger().info('CHANNELS', 'Telegram inbound bridge started');
}

async function stopTelegramInbound(): Promise<void> {
  const eng = getEngine();
  if (eng.telegramBridge) {
    try { eng.telegramBridge.stop(); } catch { /* ignore */ }
    eng.telegramBridge = null;
  }
  if (eng.gateway) {
    try { await eng.gateway.stopChannel('telegram'); } catch { /* ignore */ }
  }
  if (eng.pluginRegistry.isInstalled('telegram')) {
    eng.pluginRegistry.disable('telegram');
  }
}

async function startSlackInbound(botToken: string, appToken: string): Promise<void> {
  const eng = getEngine();
  const existing = eng.pluginRegistry.getPlugin('slack');
  if (existing) {
    eng.pluginRegistry.updateConfig('slack', { botToken, appToken });
  } else {
    const entry = getBuiltinPlugin('slack');
    if (entry) {
      eng.pluginRegistry.install(entry);
      eng.pluginRegistry.updateConfig('slack', { botToken, appToken });
    }
  }
  eng.pluginRegistry.enable('slack');

  if (eng.slackBridge) {
    try { eng.slackBridge.stop(); } catch { /* ignore */ }
    eng.slackBridge = null;
  }

  const bridge = new SlackBridge({ botToken, appToken });
  bridge.setAgentFactory(() => {
    const userCfg = eng.configManager.load();
    const userSession = eng.sessionManager.createSession(
      userCfg.provider.activeProvider,
      userCfg.provider.activeModel,
      process.cwd(),
    );
    return new Agent({
      config: userCfg,
      sessionId: userSession.id,
      systemPrompt: '',
      scopePath: userSession.scopePath,
      toolExecutor: eng.toolkit.executor,
      toolRegistry: eng.toolkit.registry,
      pgPool: eng.pgPool ?? undefined,
    });
  });
  await bridge.start();
  eng.slackBridge = bridge;
  getLogger().info('CHANNELS', 'Slack inbound bridge started');
}

async function stopSlackInbound(): Promise<void> {
  const eng = getEngine();
  if (eng.slackBridge) {
    try { eng.slackBridge.stop(); } catch { /* ignore */ }
    eng.slackBridge = null;
  }
  if (eng.pluginRegistry.isInstalled('slack')) {
    eng.pluginRegistry.disable('slack');
  }
}

async function startDiscordInbound(botToken: string, channelId?: string): Promise<void> {
  const eng = getEngine();
  const existing = eng.pluginRegistry.getPlugin('discord');
  if (existing) {
    eng.pluginRegistry.updateConfig('discord', { botToken, channelId });
  } else {
    const entry = getBuiltinPlugin('discord');
    if (entry) {
      eng.pluginRegistry.install(entry);
      eng.pluginRegistry.updateConfig('discord', { botToken, channelId });
    }
  }
  eng.pluginRegistry.enable('discord');

  if (eng.discordBridge) {
    try { eng.discordBridge.stop(); } catch { /* ignore */ }
    eng.discordBridge = null;
  }

  const bridge = new DiscordBridge();
  bridge.setAgentFactory(async () => {
    const userCfg = eng.configManager.load();
    const userProvider = userCfg.provider.activeProvider as ProviderId;
    const userSession = eng.sessionManager.createSession(
      userProvider,
      userCfg.provider.activeModel,
      process.cwd(),
    );
    return new Agent({
      config: userCfg,
      sessionId: userSession.id,
      systemPrompt: '',
      scopePath: userSession.scopePath,
      toolExecutor: eng.toolkit.executor,
      toolRegistry: eng.toolkit.registry,
      pgPool: eng.pgPool ?? undefined,
    });
  });
  await bridge.start(botToken, channelId);
  eng.discordBridge = bridge;
  getLogger().info('CHANNELS', 'Discord inbound bridge started');
}

async function stopDiscordInbound(): Promise<void> {
  const eng = getEngine();
  if (eng.discordBridge) {
    try { eng.discordBridge.stop(); } catch { /* ignore */ }
    eng.discordBridge = null;
  }
  if (eng.pluginRegistry.isInstalled('discord')) {
    eng.pluginRegistry.disable('discord');
  }
}

/** Start/stop inbound bridges from Settings → Channels config. */
export async function applyChannelsConfig(cfg?: AgentXConfig): Promise<void> {
  const eng = getEngine();
  const config = cfg ?? eng.configManager.load();
  const ch = config.channels;

  // Telegram
  if (isTelegramInboundReady(ch?.telegram)) {
    try {
      await startTelegramInbound(ch!.telegram!.botToken!);
    } catch (e) {
      getLogger().warn('CHANNELS', `Telegram inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    await stopTelegramInbound();
  }

  // Slack inbound (Socket Mode)
  const slack = ch?.slack;
  if (wantsInbound(slack) && slack?.botToken && slack?.appToken) {
    try {
      await startSlackInbound(slack.botToken, slack.appToken);
    } catch (e) {
      getLogger().warn('CHANNELS', `Slack inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!channelEnabled(slack)) {
    await stopSlackInbound();
  }

  // Discord inbound (bot)
  const discord = ch?.discord;
  if (wantsInbound(discord) && discord?.botToken) {
    try {
      await startDiscordInbound(discord.botToken, discord.channelId);
    } catch (e) {
      getLogger().warn('CHANNELS', `Discord inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!channelEnabled(discord)) {
    await stopDiscordInbound();
  }
}
