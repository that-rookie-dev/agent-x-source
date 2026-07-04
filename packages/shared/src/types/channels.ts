/** Bidirectional channel configuration (Settings → Channels). */
export type NotificationChannelId = 'telegram' | 'slack' | 'email' | 'discord';

export interface TelegramChannelConfig {
  enabled?: boolean;
  /** Receive tasks from this channel (default true when enabled). */
  inbound?: boolean;
  /** Send automation summaries / alerts (default true when enabled). */
  outbound?: boolean;
  botToken?: string;
  /** Outbound notification target — auto-detected from bot updates. */
  chatId?: string;
}

export interface SlackChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  /** Outbound: incoming webhook URL. */
  webhookUrl?: string;
  /** Inbound: Socket Mode tokens. */
  botToken?: string;
  appToken?: string;
}

export interface EmailChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromAddress?: string;
  toAddress?: string;
  useTls?: boolean;
}

export interface DiscordChannelConfig {
  enabled?: boolean;
  inbound?: boolean;
  outbound?: boolean;
  /** Outbound: channel webhook URL. */
  webhookUrl?: string;
  /** Inbound: bot token (+ optional channel filter). */
  botToken?: string;
  channelId?: string;
}

export interface NotificationChannelsConfig {
  telegram?: TelegramChannelConfig;
  slack?: SlackChannelConfig;
  email?: EmailChannelConfig;
  discord?: DiscordChannelConfig;
}

export type NotificationChannelStatus = Record<NotificationChannelId, { configured: boolean; enabled: boolean }>;

export interface TelegramDiscoveredChat {
  id: string;
  title: string;
  type: string;
}
