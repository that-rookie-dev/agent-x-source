import {
  Agent,
  DiscordBridge,
  Gateway,
  SlackBridge,
  TelegramChannelPlugin,
  getBuiltinPlugin,
  getActiveTelegramBridge,
  resolveTelegramOutboundChatId,
} from '@agentx/engine';
import type { AgentXConfig, NotificationChannelsConfig, ProviderId, TelegramDiscoveredChat } from '@agentx/shared';
import { parseAllowedUserIds } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { randomUUID } from 'node:crypto';
import { ensureChannelAgent, getEngine, rewireTelegramChannelPermissions, syncChannelSuperSessionContext } from './engine.js';

export interface TelegramDiscoverResult {
  ok: boolean;
  error?: string;
  botUsername?: string;
  botName?: string;
  chats?: TelegramDiscoveredChat[];
  /** True when bot token + chat were written to config (survives restart). */
  saved?: boolean;
  chatId?: string;
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

function resolveTelegramBotToken(ch?: NotificationChannelsConfig['telegram']): string | undefined {
  const fromConfig = ch?.botToken?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  return fromEnv || undefined;
}

let lastTelegramStartError: string | null = null;

export function getTelegramInboundStatus(): {
  bridgeRunning: boolean;
  botUsername?: string;
  channelAgentAttached: boolean;
  channelSessionId?: string;
  queueDepth?: number;
  savedEnabled: boolean;
  savedChatId?: string;
  hasBotToken: boolean;
  inboundReady: boolean;
  lastStartError?: string | null;
} {
  const eng = getEngine();
  let cfg: AgentXConfig;
  try {
    cfg = eng.configManager.load();
  } catch {
    return {
      bridgeRunning: false,
      channelAgentAttached: false,
      savedEnabled: false,
      hasBotToken: false,
      inboundReady: false,
      lastStartError: lastTelegramStartError ?? 'Config not loaded (sign in first)',
    };
  }
  const ch = cfg.channels?.telegram;
  const bridge = eng.telegramBridge;
  const plugin = (eng.gateway as { registry?: { getChannel?: (id: string) => { plugin?: { getActiveChatId?: () => number | null; getBridge?: () => unknown } } } } | null)
    ?.registry?.getChannel?.('telegram')?.plugin;
  const token = resolveTelegramBotToken(ch);
  return {
    bridgeRunning: Boolean(bridge?.isRunning()),
    botUsername: bridge?.getStatus?.().botUsername,
    channelAgentAttached: Boolean(eng.channelAgent && plugin),
    channelSessionId: eng.channelAgent?.currentSessionId,
    queueDepth: undefined,
    savedEnabled: ch?.enabled === true,
    savedChatId: ch?.chatId,
    hasBotToken: Boolean(token),
    inboundReady: isTelegramInboundReady(ch),
    lastStartError: lastTelegramStartError,
  };
}

/** Retry starting the inbound bridge (after login or config save). */
export async function restartTelegramInbound(): Promise<{ ok: boolean; error?: string; status: ReturnType<typeof getTelegramInboundStatus> }> {
  try {
    await applyChannelsConfig();
    const status = getTelegramInboundStatus();
    if (!status.inboundReady) {
      const reason = !status.hasBotToken
        ? 'Bot token not saved. Re-enter your token in Settings → Channels and click Verify token.'
        : !status.savedEnabled
          ? 'Telegram channel is disabled in saved config.'
          : 'Telegram inbound is not configured.';
      return { ok: false, error: reason, status };
    }
    if (!status.bridgeRunning) {
      return { ok: false, error: lastTelegramStartError ?? 'Bridge failed to start', status };
    }
    return { ok: true, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastTelegramStartError = msg;
    return { ok: false, error: msg, status: getTelegramInboundStatus() };
  }
}

export function isTelegramOutboundReady(ch?: NotificationChannelsConfig['telegram']): boolean {
  return wantsOutbound(ch) && Boolean(resolveTelegramBotToken(ch) && ch?.chatId);
}

export function isTelegramInboundReady(ch?: NotificationChannelsConfig['telegram']): boolean {
  return wantsInbound(ch) && Boolean(resolveTelegramBotToken(ch));
}

/** Persist Telegram credentials so verify/greeting are one-time setup (survives restart). */
export function persistTelegramSettings(patch: {
  botToken?: string;
  chatId?: string;
  enabled?: boolean;
}): AgentXConfig {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const telegram = {
    enabled: false,
    inbound: true,
    outbound: true,
    ...cfg.channels?.telegram,
    ...patch,
  };
  const next: AgentXConfig = {
    ...cfg,
    channels: {
      ...cfg.channels,
      telegram,
    },
  };
  eng.configManager.save(next);
  return next;
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
  const cfg = eng.configManager.load();
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

  if (process.env['AGENTX_DAEMON_HANDLES_TG']) return;

  const channelAgent = ensureChannelAgent();

  if (eng.telegramBridge?.isRunning() && eng.gateway) {
    const runningEntry = eng.gateway.registry.getChannel('telegram');
    const runningPlugin = runningEntry?.plugin instanceof TelegramChannelPlugin
      ? runningEntry.plugin
      : null;
    if (runningPlugin) {
      runningPlugin.setAgent(channelAgent);
      runningPlugin.setChatIdPersister((id) => saveTelegramChatId(id));
      runningPlugin.rewirePermissionHandling();
      getLogger().info('CHANNELS', 'Telegram inbound bridge already running — rewired agent');
      return;
    }
  }

  if (eng.gateway) {
    try { eng.gateway.stopChannel('telegram'); } catch { /* ignore */ }
  } else {
    eng.gateway = new Gateway();
  }
  eng.gateway.attachAgent(channelAgent);

  const existingEntry = eng.gateway.registry.getChannel('telegram');
  const tgAllowed = parseAllowedUserIds(cfg.channels?.telegram?.allowedUserIds)
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n));
  const tgPlugin = existingEntry?.plugin instanceof TelegramChannelPlugin
    ? existingEntry.plugin
    : eng.gateway.registerTelegram(token, tgAllowed.length > 0 ? tgAllowed : undefined);
  tgPlugin.setAgent(channelAgent);
  tgPlugin.setChatIdPersister((id) => saveTelegramChatId(id));
  await eng.gateway.startChannel('telegram');
  eng.telegramBridge = eng.gateway.getTelegramBridge();
  try {
    rewireTelegramChannelPermissions(eng);
  } catch (e) {
    getLogger().warn('CHANNELS', `Telegram permission rewire failed: ${e instanceof Error ? e.message : String(e)}`);
  }
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

async function startSlackInbound(botToken: string, appToken: string, allowedUserIds?: string[]): Promise<void> {
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
  bridge.setAllowedUserIds(allowedUserIds ?? []);
  bridge.setAgentFactory((_userId) => {
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

async function startDiscordInbound(botToken: string, channelId?: string, allowedUserIds?: string[]): Promise<void> {
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
  bridge.setAllowedUserIds(allowedUserIds ?? []);
  bridge.setAgentFactory(async (_userId) => {
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
  const telegramToken = resolveTelegramBotToken(ch?.telegram);
  if (isTelegramInboundReady(ch?.telegram) && telegramToken) {
    try {
      lastTelegramStartError = null;
      await startTelegramInbound(telegramToken);
    } catch (e) {
      lastTelegramStartError = e instanceof Error ? e.message : String(e);
      getLogger().warn('CHANNELS', `Telegram inbound start failed: ${lastTelegramStartError}`);
    }
  } else if (!channelEnabled(ch?.telegram)) {
    await stopTelegramInbound();
  } else if (ch?.telegram?.enabled && !telegramToken) {
    lastTelegramStartError = 'Bot token missing from saved config — re-verify in Settings → Channels';
    getLogger().warn('CHANNELS', lastTelegramStartError);
  }

  // Slack inbound (Socket Mode)
  const slack = ch?.slack;
  const slackAllowed = parseAllowedUserIds(slack?.allowedUserIds);
  if (wantsInbound(slack) && slack?.botToken && slack?.appToken) {
    try {
      await startSlackInbound(slack.botToken, slack.appToken, slackAllowed);
    } catch (e) {
      getLogger().warn('CHANNELS', `Slack inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!channelEnabled(slack)) {
    await stopSlackInbound();
  }

  // Discord inbound (bot)
  const discord = ch?.discord;
  const discordAllowed = parseAllowedUserIds(discord?.allowedUserIds);
  if (wantsInbound(discord) && discord?.botToken) {
    try {
      await startDiscordInbound(discord.botToken, discord.channelId, discordAllowed);
    } catch (e) {
      getLogger().warn('CHANNELS', `Discord inbound start failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!channelEnabled(discord)) {
    await stopDiscordInbound();
  }
}

/** Generate a fresh LLM greeting and push it to the configured Telegram chat. */
export async function sendTelegramGreeting(overrides?: {
  botToken?: string;
  chatId?: string;
}): Promise<{ ok: boolean; message?: string; error?: string }> {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const botToken = overrides?.botToken?.trim()
    ?? resolveTelegramBotToken(cfg.channels?.telegram)
    ?? process.env['TELEGRAM_BOT_TOKEN']?.trim();
  const chatId = overrides?.chatId?.trim()
    ?? resolveTelegramOutboundChatId(cfg, getTelegramRuntimeHints());

  if (!botToken) {
    return { ok: false, error: 'Bot token required.' };
  }
  if (!chatId) {
    return { ok: false, error: 'Chat not linked. Message your bot in Telegram, then verify the token.' };
  }
  if (!cfg.provider.activeProvider || !cfg.provider.activeModel) {
    return { ok: false, error: 'Configure a provider and model before sending a greeting.' };
  }

  const agent = ensureChannelAgent();
  syncChannelSuperSessionContext(eng);

  const nonce = randomUUID().slice(0, 8);
  let greeting: string;
  try {
    greeting = await agent.generateOutboundText(
      `Write a fresh, friendly Telegram greeting welcoming the user to Agent-X. Unique request ${nonce} — use different wording every time (avoid stock phrases like "Hello there" every time). Mention you are connected on Telegram and ready to help. Keep it to 1–3 sentences.`,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to generate greeting' };
  }

  try {
    const bridge = eng.telegramBridge ?? getActiveTelegramBridge();
    if (bridge?.isRunning()) {
      await bridge.sendToChat(Number(chatId), greeting);
    } else {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: greeting }),
        signal: AbortSignal.timeout(15000),
      });
      const json = await response.json() as { ok?: boolean; description?: string };
      if (!json.ok) {
        return { ok: false, error: json.description ?? 'Telegram send failed' };
      }
    }
    getLogger().info('CHANNELS', `Telegram greeting sent (${greeting.slice(0, 60)}…)`);
    const savedCfg = persistTelegramSettings({ botToken, chatId, enabled: true });
    try {
      await applyChannelsConfig(savedCfg);
    } catch (e) {
      getLogger().warn('CHANNELS', `Telegram inbound start after greeting failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { ok: true, message: greeting };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Telegram send failed' };
  }
}

/** Save verified Telegram credentials and start the inbound listener. */
export async function saveVerifiedTelegram(
  botToken: string,
  chatId: string,
): Promise<TelegramDiscoverResult> {
  const token = botToken.trim();
  const id = chatId.trim();
  if (!token || !id) return { ok: false, error: 'Bot token and chat id are required' };

  const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(12000) });
  const meJson = await meRes.json() as { ok?: boolean; description?: string; result?: { username?: string; first_name?: string } };
  if (!meJson.ok) {
    return { ok: false, error: meJson.description ?? 'Invalid bot token' };
  }

  const savedCfg = persistTelegramSettings({ botToken: token, chatId: id, enabled: true });
  try {
    await applyChannelsConfig(savedCfg);
  } catch (e) {
    getLogger().warn('CHANNELS', `Failed to apply Telegram config after verify: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: true,
    saved: true,
    chatId: id,
    botUsername: meJson.result?.username,
    botName: meJson.result?.first_name,
    chats: [{ id, title: `Chat ${id}`, type: 'known' }],
  };
}
