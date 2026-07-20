import type { NotificationChannelsConfig } from '@agentx/shared';

export function channelEnabled(section: { enabled?: boolean } | undefined): boolean {
  return section?.enabled === true;
}

export function wantsInbound(section: { inbound?: boolean; enabled?: boolean } | undefined): boolean {
  return channelEnabled(section) && section?.inbound !== false;
}

export function wantsOutbound(section: { outbound?: boolean; enabled?: boolean } | undefined): boolean {
  return channelEnabled(section) && section?.outbound !== false;
}

export function resolveTelegramBotToken(ch?: NotificationChannelsConfig['telegram']): string | undefined {
  const fromConfig = ch?.botToken?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  return fromEnv || undefined;
}

/** Shared mutable runtime state for Telegram inbound (cross-module). */
export const telegramRuntime = {
  lastStartError: null as string | null,
};
