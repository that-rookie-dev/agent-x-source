import {
  Gateway,
  TelegramChannelPlugin,
  getBuiltinPlugin,
  getActiveTelegramBridge,
  resolveTelegramOutboundChatId,
  getPersonaStore,
} from '@agentx/engine';
import type { AgentXConfig, NotificationChannelsConfig, TelegramDiscoveredChat } from '@agentx/shared';
import { parseAllowedUserIds } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { randomUUID } from 'node:crypto';
import { ensureChannelAgent, getEngine, rewireTelegramChannelPermissions, syncChannelSuperSessionContext } from '../engine.js';
import { wantsInbound, wantsOutbound, resolveTelegramBotToken, telegramRuntime } from './shared.js';
import { applyChannelsConfig } from './config.js';

export interface TelegramDiscoverResult {
  ok: boolean;
  error?: string;
  botUsername?: string;
  botName?: string;
  chats?: TelegramDiscoveredChat[];
  /** True when bot token + chat were written to config (survives restart). */
  saved?: boolean;
  chatId?: string;
  /** Telegram user id linked as the sole inbound owner. */
  allowedUserId?: string;
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
      result?: Array<{
        message?: {
          from?: { id?: number; first_name?: string; username?: string };
          chat?: { id?: number; title?: string; first_name?: string; username?: string; type?: string };
        };
      }>;
    };
    if (!updatesJson.ok) {
      return { ok: false, error: updatesJson.description ?? 'Failed to fetch updates' };
    }

    const chatMap = new Map<string, TelegramDiscoveredChat>();
    let allowedUserId: string | undefined;

    // Walk updates in order; the latest private DM wins as the linked owner.
    for (const update of updatesJson.result ?? []) {
      const msg = update.message;
      const chat = msg?.chat;
      const fromId = msg?.from?.id;
      if (!chat?.id) continue;
      const id = String(chat.id);
      const type = chat.type ?? 'unknown';
      const title = chat.title
        ?? chat.first_name
        ?? (chat.username ? `@${chat.username}` : `Chat ${id}`);
      const userId = fromId != null ? String(fromId) : undefined;
      chatMap.set(id, { id, title, type, userId });
      if (type === 'private' && userId) {
        allowedUserId = userId;
      }
    }

    for (const knownId of options?.knownChatIds ?? []) {
      const id = knownId.trim();
      if (!id || chatMap.has(id)) continue;
      // Private chat ids are positive; treat as private owner when backfilling from config.
      const isPrivate = !id.startsWith('-');
      chatMap.set(id, {
        id,
        title: `Chat ${id}`,
        type: isPrivate ? 'private' : 'known',
        userId: isPrivate ? id : undefined,
      });
    }

    const chats = [...chatMap.values()].sort((a, b) => {
      if (a.type === 'private' && b.type !== 'private') return -1;
      if (b.type === 'private' && a.type !== 'private') return 1;
      return 0;
    });

    // Private DM chat id equals the user id — use that when updates only had known hints.
    if (!allowedUserId) {
      const privateChat = chats.find((c) => c.type === 'private' && c.userId);
      allowedUserId = privateChat?.userId;
    }

    return {
      ok: true,
      botUsername: meJson.result?.username,
      botName: meJson.result?.first_name,
      chats,
      allowedUserId,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Telegram API request failed' };
  }
}

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
      lastStartError: telegramRuntime.lastStartError ?? 'Config not loaded (sign in first)',
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
    lastStartError: telegramRuntime.lastStartError,
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
      return { ok: false, error: telegramRuntime.lastStartError ?? 'Bridge failed to start', status };
    }
    return { ok: true, status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    telegramRuntime.lastStartError = msg;
    return { ok: false, error: msg, status: getTelegramInboundStatus() };
  }
}

export function isTelegramOutboundReady(ch?: NotificationChannelsConfig['telegram']): boolean {
  return wantsOutbound(ch) && Boolean(resolveTelegramBotToken(ch) && ch?.chatId);
}

export function isTelegramInboundReady(ch?: NotificationChannelsConfig['telegram']): boolean {
  if (!wantsInbound(ch) || !resolveTelegramBotToken(ch)) return false;
  // Require a linked owner (or legacy private chat id) before starting the bridge,
  // so the first verify message is not consumed/rejected during linking.
  if (parseAllowedUserIds(ch?.allowedUserIds).length > 0) return true;
  const chatId = ch?.chatId?.trim();
  return Boolean(chatId && !chatId.startsWith('-'));
}

/** Persist Telegram credentials so verify/greeting are one-time setup (survives restart). */
export function persistTelegramSettings(patch: {
  botToken?: string;
  chatId?: string;
  allowedUserIds?: string;
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

export async function startTelegramInbound(token: string): Promise<void> {
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

  const channelAgent = ensureChannelAgent('telegram');

  const claimOwner = (userId: number, chatId: number) => {
    persistTelegramSettings({
      allowedUserIds: String(userId),
      chatId: String(chatId),
      enabled: true,
    });
  };

  if (eng.telegramBridge?.isRunning() && eng.gateway) {
    const runningEntry = eng.gateway.registry.getChannel('telegram');
    const runningPlugin = runningEntry?.plugin instanceof TelegramChannelPlugin
      ? runningEntry.plugin
      : null;
    if (runningPlugin) {
      const tgAllowed = parseAllowedUserIds(cfg.channels?.telegram?.allowedUserIds)
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n));
      runningPlugin.setAllowedUserIds(tgAllowed);
      runningPlugin.setAgent(channelAgent);
      runningPlugin.setChatIdPersister((id) => saveTelegramChatId(id));
      runningPlugin.setOwnerClaimHandler(claimOwner);
      runningPlugin.rewirePermissionHandling();
      getLogger().info('CHANNELS', 'Telegram inbound bridge already running — rewired agent + allowlist');
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
    : eng.gateway.registerTelegram(token, tgAllowed);
  tgPlugin.setAllowedUserIds(tgAllowed);
  tgPlugin.setAgent(channelAgent);
  tgPlugin.setChatIdPersister((id) => saveTelegramChatId(id));
  tgPlugin.setOwnerClaimHandler(claimOwner);
  await eng.gateway.startChannel('telegram');
  eng.telegramBridge = eng.gateway.getTelegramBridge();
  try {
    rewireTelegramChannelPermissions(eng);
  } catch (e) {
    getLogger().warn('CHANNELS', `Telegram permission rewire failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  getLogger().info('CHANNELS', 'Telegram inbound bridge started');
}

export async function stopTelegramInbound(): Promise<void> {
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

  const agent = ensureChannelAgent('telegram');
  syncChannelSuperSessionContext(eng, 'telegram');

  const nonce = randomUUID().slice(0, 8);
  const persona = getPersonaStore().get();
  const agentName = persona?.name ?? 'Agent-X';
  let greeting: string;
  try {
    greeting = await agent.generateOutboundText(
      `Write a fresh, friendly Telegram greeting welcoming the user. You are ${agentName}. Unique request ${nonce} — use different wording every time (avoid stock phrases like "Hello there" every time). Mention you are connected on Telegram and ready to help. Keep it to 1–3 sentences.`,
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
    const savedCfg = persistTelegramSettings({
      botToken,
      chatId,
      // Private chat id equals the Telegram user id — link as sole owner.
      allowedUserIds: !chatId.startsWith('-') ? chatId : undefined,
      enabled: true,
    });
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
  allowedUserId: string,
): Promise<TelegramDiscoverResult> {
  const token = botToken.trim();
  const id = chatId.trim();
  const ownerId = allowedUserId.trim();
  if (!token || !id) return { ok: false, error: 'Bot token and chat id are required' };
  if (!ownerId) {
    return { ok: false, error: 'Open Telegram, send a private message to your bot, then verify again.' };
  }

  const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(12000) });
  const meJson = await meRes.json() as { ok?: boolean; description?: string; result?: { username?: string; first_name?: string } };
  if (!meJson.ok) {
    return { ok: false, error: meJson.description ?? 'Invalid bot token' };
  }

  const savedCfg = persistTelegramSettings({
    botToken: token,
    chatId: id,
    allowedUserIds: ownerId,
    enabled: true,
  });
  try {
    await applyChannelsConfig(savedCfg);
  } catch (e) {
    getLogger().warn('CHANNELS', `Failed to apply Telegram config after verify: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: true,
    saved: true,
    chatId: id,
    allowedUserId: ownerId,
    botUsername: meJson.result?.username,
    botName: meJson.result?.first_name,
    chats: [{ id, title: `Chat ${id}`, type: 'private', userId: ownerId }],
  };
}
