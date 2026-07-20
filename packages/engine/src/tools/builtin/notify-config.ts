import type { AgentXConfig } from '@agentx/shared';
import { ConfigManager } from '../../config/ConfigManager.js';

export function resolveTelegramNotifyCredentials(config?: AgentXConfig | null): { botToken?: string; chatId?: string } {
  const telegram = config?.channels?.telegram;
  if (telegram?.botToken) {
    const chatId = telegram.chatId?.trim() || telegram.allowedUserIds?.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)[0];
    return {
      botToken: telegram.botToken,
      chatId: chatId ?? process.env['TELEGRAM_CHAT_ID'],
    };
  }
  try {
    const cfg = new ConfigManager().load();
    return {
      botToken: cfg.channels?.telegram?.botToken ?? process.env['TELEGRAM_BOT_TOKEN'],
      chatId: cfg.channels?.telegram?.chatId ?? process.env['TELEGRAM_CHAT_ID'],
    };
  } catch {
    return {
      botToken: process.env['TELEGRAM_BOT_TOKEN'],
      chatId: process.env['TELEGRAM_CHAT_ID'],
    };
  }
}

export function resolveSlackWebhookUrl(config?: AgentXConfig | null): string | undefined {
  if (config?.channels?.slack?.webhookUrl) {
    return config.channels.slack.webhookUrl;
  }
  try {
    const cfg = new ConfigManager().load();
    return cfg.channels?.slack?.webhookUrl ?? process.env['SLACK_WEBHOOK_URL'];
  } catch {
    return process.env['SLACK_WEBHOOK_URL'];
  }
}

export function resolveDiscordWebhookUrl(config?: AgentXConfig | null): string | undefined {
  if (config?.channels?.discord?.webhookUrl) {
    return config.channels.discord.webhookUrl;
  }
  try {
    const cfg = new ConfigManager().load();
    return cfg.channels?.discord?.webhookUrl;
  } catch {
    return undefined;
  }
}

export function resolveEmailSmtpConfig(config?: AgentXConfig | null): {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromAddress?: string;
  toAddress?: string;
} {
  const email = config?.channels?.email;
  if (email) {
    return {
      smtpHost: email.smtpHost,
      smtpPort: email.smtpPort,
      smtpUser: email.smtpUser,
      smtpPassword: email.smtpPassword,
      fromAddress: email.fromAddress,
      toAddress: email.toAddress,
    };
  }
  try {
    const cfgEmail = new ConfigManager().load().channels?.email;
    return {
      smtpHost: cfgEmail?.smtpHost,
      smtpPort: cfgEmail?.smtpPort,
      smtpUser: cfgEmail?.smtpUser,
      smtpPassword: cfgEmail?.smtpPassword,
      fromAddress: cfgEmail?.fromAddress,
      toAddress: cfgEmail?.toAddress,
    };
  } catch {
    return {};
  }
}
