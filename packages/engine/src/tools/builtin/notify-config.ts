import { ConfigManager } from '../../config/ConfigManager.js';

export function resolveTelegramNotifyCredentials(): { botToken?: string; chatId?: string } {
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

export function resolveSlackWebhookUrl(): string | undefined {
  try {
    const cfg = new ConfigManager().load();
    return cfg.channels?.slack?.webhookUrl ?? process.env['SLACK_WEBHOOK_URL'];
  } catch {
    return process.env['SLACK_WEBHOOK_URL'];
  }
}

export function resolveDiscordWebhookUrl(): string | undefined {
  try {
    const cfg = new ConfigManager().load();
    return cfg.channels?.discord?.webhookUrl;
  } catch {
    return undefined;
  }
}

export function resolveEmailSmtpConfig(): {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromAddress?: string;
  toAddress?: string;
} {
  try {
    const email = new ConfigManager().load().channels?.email;
    return {
      smtpHost: email?.smtpHost,
      smtpPort: email?.smtpPort,
      smtpUser: email?.smtpUser,
      smtpPassword: email?.smtpPassword,
      fromAddress: email?.fromAddress,
      toAddress: email?.toAddress,
    };
  } catch {
    return {};
  }
}
