import type { AgentXConfig, AutomationNotifyChannel, NotificationChannelStatus, QuestionnairePayload } from '@agentx/shared';

export const AUTOMATION_NOTIFY_NONE = 'none';

const EXTERNAL_CHANNELS: AutomationNotifyChannel[] = ['telegram', 'slack', 'email', 'discord'];

export interface NotificationChannelRuntimeHints {
  /** Active Telegram chat (e.g. from a running bridge when config chatId is unset). */
  telegramChatId?: string | null;
}

export function resolveTelegramOutboundChatId(
  cfg: AgentXConfig | null | undefined,
  runtime?: NotificationChannelRuntimeHints,
): string | null {
  const fromConfig = cfg?.channels?.telegram?.chatId?.trim();
  if (fromConfig) return fromConfig;
  const fromRuntime = runtime?.telegramChatId?.trim();
  if (fromRuntime) return fromRuntime;
  const fromEnv = process.env['TELEGRAM_CHAT_ID']?.trim();
  return fromEnv || null;
}

export function getNotificationChannelStatus(
  cfg: AgentXConfig | null | undefined,
  runtime?: NotificationChannelRuntimeHints,
): NotificationChannelStatus {
  const channels = cfg?.channels;
  const telegramChatId = resolveTelegramOutboundChatId(cfg, runtime);
  const telegramConfigured = Boolean(
    channels?.telegram?.enabled === true
    && channels?.telegram?.botToken
    && telegramChatId
    && channels.telegram.outbound !== false,
  ) || Boolean(process.env['TELEGRAM_BOT_TOKEN'] && telegramChatId);

  const slackConfigured = Boolean(
    channels?.slack?.enabled === true
    && channels?.slack?.webhookUrl
    && channels.slack.outbound !== false,
  ) || Boolean(process.env['SLACK_WEBHOOK_URL']);

  const emailConfigured = Boolean(
    channels?.email?.enabled === true
    && channels?.email?.outbound !== false
    && channels.email.smtpHost
    && channels.email.fromAddress
    && channels.email.toAddress,
  );

  const discordConfigured = Boolean(
    channels?.discord?.enabled === true
    && channels?.discord?.webhookUrl
    && channels.discord.outbound !== false,
  );

  return {
    telegram: { configured: telegramConfigured, enabled: channels?.telegram?.enabled === true },
    slack: { configured: slackConfigured, enabled: channels?.slack?.enabled === true },
    email: { configured: emailConfigured, enabled: channels?.email?.enabled === true },
    discord: { configured: discordConfigured, enabled: channels?.discord?.enabled === true },
  };
}

export function buildAutomationNotifyQuestionnaire(
  status: NotificationChannelStatus,
): QuestionnairePayload {
  return {
    id: crypto.randomUUID(),
    title: 'Automation notifications',
    submitLabel: 'Continue',
    allowSkip: false,
    source: { kind: 'agent' },
    questions: [{
      id: 'notify_channels',
      prompt: 'How should results be delivered when this automation completes? (Select all that apply, or choose Nothing.)',
      type: 'multi_choice',
      required: true,
      allowCustom: false,
      options: [
        { value: 'in_app', label: 'Notification tray (in-app)' },
        {
          value: 'telegram',
          label: status.telegram.configured ? 'Telegram' : 'Telegram (not configured)',
          disabled: !status.telegram.configured,
        },
        {
          value: 'slack',
          label: status.slack.configured ? 'Slack' : 'Slack (not configured)',
          disabled: !status.slack.configured,
        },
        {
          value: 'discord',
          label: status.discord.configured ? 'Discord' : 'Discord (not configured)',
          disabled: !status.discord.configured,
        },
        {
          value: 'email',
          label: status.email.configured ? 'Email' : 'Email (not configured)',
          disabled: !status.email.configured,
        },
        { value: AUTOMATION_NOTIFY_NONE, label: 'Nothing — no notifications' },
      ],
    }],
  };
}

function parseMultiChoiceLine(line: string): string[] {
  const idx = line.indexOf(': ');
  const body = idx >= 0 ? line.slice(idx + 2) : line;
  if (!body || body === '(skipped)') return [];
  return body.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Parse questionnaire answer text into automation notify channels. */
export function parseAutomationNotifyAnswer(answer: string): AutomationNotifyChannel[] {
  const lines = answer.split('\n').map((l) => l.trim()).filter(Boolean);
  let rawValues: string[] = [];
  for (const line of lines) {
    if (/notify/i.test(line) || line.includes('deliver') || line.includes('notification')) {
      rawValues = parseMultiChoiceLine(line);
      break;
    }
  }
  if (!rawValues.length) {
    rawValues = parseMultiChoiceLine(lines[lines.length - 1] ?? answer);
  }

  const normalized = rawValues.map((v) => v.toLowerCase());
  if (normalized.includes(AUTOMATION_NOTIFY_NONE)) {
    return [];
  }

  const out = new Set<AutomationNotifyChannel>();
  for (const value of normalized) {
    if (value === 'in_app' || value === 'notification tray' || value.includes('tray')) out.add('in_app');
    else if (value === 'telegram') out.add('telegram');
    else if (value === 'slack') out.add('slack');
    else if (value === 'email') out.add('email');
    else if (value === 'discord') out.add('discord');
    else if (value === 'desktop') out.add('desktop');
  }
  return [...out];
}

export function notifyToolsForChannels(channels: AutomationNotifyChannel[]): string[] {
  const tools: string[] = [];
  if (channels.includes('desktop')) tools.push('notify_desktop');
  if (channels.includes('telegram')) tools.push('notify_telegram');
  if (channels.includes('slack')) tools.push('notify_slack');
  if (channels.includes('email')) tools.push('notify_email');
  if (channels.includes('discord')) tools.push('notify_discord');
  return tools;
}

export function normalizeNotifyChannelArgs(raw: unknown): AutomationNotifyChannel[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const allowed = new Set<AutomationNotifyChannel>(['in_app', 'desktop', 'telegram', 'slack', 'email', 'discord']);
  const parsed = raw.filter((c): c is AutomationNotifyChannel => typeof c === 'string' && allowed.has(c as AutomationNotifyChannel));
  return parsed.length ? parsed : undefined;
}

export function externalChannelsOnly(channels: AutomationNotifyChannel[]): AutomationNotifyChannel[] {
  return channels.filter((c) => EXTERNAL_CHANNELS.includes(c));
}
