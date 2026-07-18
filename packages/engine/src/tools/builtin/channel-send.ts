import { readFileSync } from 'node:fs';
import { basename, extname, resolve, isAbsolute } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { isAgentInternalPath } from '@agentx/shared';
import { getChannelServiceInstance } from '../../services/ServiceContext.js';
import type { ChannelId, OutboundMessage } from '../../services/channel/IChannelService.js';
import { createTransport } from 'nodemailer';
import { TelegramBridge } from '../../telegram/TelegramBridge.js';
import { resolveTelegramNotifyCredentials, resolveEmailSmtpConfig } from './notify-config.js';
import { notifyTelegram, notifySlack, notifyDiscord } from './notifications.js';

const SUPPORTED_CHANNELS: ChannelId[] = ['telegram', 'discord', 'slack', 'email'];

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.json': 'application/json',
};

function mimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

function resolveAttachmentPath(filePath: string, scopePath: string): string {
  // App-internal paths (data/tmp/files) are always allowed — resolve them as-is.
  if (isAbsolute(filePath) && isAgentInternalPath(filePath)) {
    return filePath;
  }
  // Relative paths and workspace-scoped absolute paths resolve against the agent scope.
  // ToolExecutor's ScopeGuard has already validated the path before this point.
  return resolve(scopePath, filePath);
}

function readAttachment(filePath: string, scopePath: string): { name: string; content: Buffer; contentType: string } {
  const resolved = resolveAttachmentPath(filePath, scopePath);
  const content = readFileSync(resolved);
  const name = basename(resolved) || 'attachment';
  return { name, content, contentType: mimeFromPath(resolved) };
}

function buildOutboundMessage(
  channel: ChannelId,
  text: string,
  attachment: { name: string; content: Buffer; contentType: string } | undefined,
  threadId: string | undefined,
  to: string | undefined,
  subject: string | undefined,
): OutboundMessage {
  const message: OutboundMessage = { text, threadId };
  if (attachment) {
    message.attachments = [
      { name: attachment.name, content: attachment.content, contentType: attachment.contentType },
    ];
  }
  if (channel === 'email') {
    message.to = to;
    message.subject = subject || (attachment ? 'Agent-X attachment' : 'Agent-X message');
  }
  return message;
}

interface ResolvedChannel {
  channel: ChannelId;
  threadId?: string;
  error?: string;
}

function getConfiguredDefaultRecipient(config: ToolExecutionContext['config'], channel: ChannelId): string | undefined {
  const channels = config?.channels as Record<string, { chatId?: string; channelId?: string; toAddress?: string; allowedUserIds?: string }> | undefined;
  const cfg = channels?.[channel];
  if (!cfg) return undefined;
  if (channel === 'telegram') {
    return cfg.chatId?.trim() || cfg.allowedUserIds?.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)[0];
  }
  if (channel === 'discord') {
    return cfg.channelId;
  }
  if (channel === 'email') {
    return cfg.toAddress;
  }
  return undefined;
}

function resolveChannel(
  context: ToolExecutionContext,
  expectedChannel: ChannelId,
  explicitRecipient?: string,
): ResolvedChannel {
  if (!SUPPORTED_CHANNELS.includes(expectedChannel)) {
    return { channel: expectedChannel, error: `Unsupported channel: ${expectedChannel}` };
  }
  const activeChannel = context.sourceChannel as ChannelId | undefined;
  // Cross-channel routing: if the user explicitly asks to send to a DIFFERENT channel
  // than the one they're on (e.g. "send to Telegram" while on Slack), allow it as long
  // as a recipient/thread is provided. Only block if no recipient and channel mismatch.
  const activeThreadId = activeChannel === expectedChannel ? context.sourceThreadId : undefined;
  const threadId = explicitRecipient ?? activeThreadId ?? getConfiguredDefaultRecipient(context.config, expectedChannel);
  return { channel: expectedChannel, threadId };
}

async function sendDirect(
  channel: ChannelId,
  text: string,
  attachment: { name: string; content: Buffer; contentType: string } | undefined,
  caption: string | undefined,
  subject: string | undefined,
  recipient: string | undefined,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const messageText = text || caption || '';

  if (channel === 'telegram') {
    if (attachment) {
      const { botToken, chatId } = resolveTelegramNotifyCredentials(context.config);
      if (!botToken || !chatId) {
        return { success: false, output: 'Telegram is not configured for outbound messages.', error: 'CONFIG_MISSING' };
      }
      const bridge = new TelegramBridge({ botToken });
      const result = await bridge.sendDocumentToChat(Number(chatId), { name: attachment.name, content: attachment.content }, caption);
      return result.ok
        ? { success: true, output: 'Telegram file sent' }
        : { success: false, output: result.description ?? 'Failed to send Telegram file', error: 'SEND_ERROR' };
    }
    return notifyTelegram({ message: messageText }, context);
  }

  if (channel === 'slack') {
    if (attachment) {
      return { success: false, output: 'Slack file upload requires the Slack channel bridge; it cannot be sent through webhook fallback.', error: 'SEND_ERROR' };
    }
    return notifySlack({ message: messageText }, context);
  }

  if (channel === 'discord') {
    if (attachment) {
      return { success: false, output: 'Discord file upload requires the Discord channel bridge; it cannot be sent through webhook fallback.', error: 'SEND_ERROR' };
    }
    return notifyDiscord({ message: messageText }, context);
  }

  if (channel === 'email') {
    const cfg = resolveEmailSmtpConfig(context.config);
    const to = recipient ?? cfg.toAddress;
    if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPassword || !to) {
      return { success: false, output: 'Email/SMTP is not configured.', error: 'CONFIG_MISSING' };
    }
    const transporter = createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort ?? 587,
      secure: (cfg.smtpPort ?? 587) === 465,
      auth: { user: cfg.smtpUser, pass: cfg.smtpPassword },
    });
    await transporter.sendMail({
      from: cfg.fromAddress ?? cfg.smtpUser,
      to,
      subject: subject || (attachment ? 'Agent-X attachment' : 'Agent-X message'),
      text: messageText,
      attachments: attachment
        ? [{ filename: attachment.name, content: attachment.content, contentType: attachment.contentType }]
        : undefined,
    });
    return { success: true, output: 'Email sent' };
  }

  return { success: false, output: `Unsupported channel: ${channel}`, error: 'INVALID_CHANNEL' };
}

async function sendToChannel(
  channel: ChannelId,
  context: ToolExecutionContext,
  text: string,
  attachmentPath?: string,
  caption?: string,
  recipient?: string,
  subject?: string,
): Promise<ToolResult> {
  const resolved = resolveChannel(context, channel, recipient);
  if (resolved.error) {
    return { success: false, output: resolved.error, error: 'INVALID_CHANNEL' };
  }
  if (!resolved.threadId && channel !== 'telegram' && channel !== 'discord' && channel !== 'slack') {
    // email needs recipient; telegram/discord/slack can sometimes use default configured channel
    return { success: false, output: 'Recipient is required when not replying to an active channel thread.', error: 'MISSING_RECIPIENT' };
  }

  let attachment: { name: string; content: Buffer; contentType: string } | undefined;
  if (attachmentPath) {
    try {
      attachment = readAttachment(attachmentPath, context.scopePath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, output: `Failed to read attachment: ${msg}`, error: 'FILE_READ_ERROR' };
    }
  }

  const messageText = text || caption || '';
  const message = buildOutboundMessage(
    channel,
    messageText,
    attachment,
    resolved.threadId,
    recipient ?? resolved.threadId,
    subject,
  );
  if (context.sourceMessageId && (channel === 'slack' || channel === 'email')) {
    message.replyTo = context.sourceMessageId;
  }

  const channelService = getChannelServiceInstance();
  if (!channelService) {
    return sendDirect(channel, messageText, attachment, caption, subject, recipient, context);
  }

  try {
    await channelService.send(channel, message);
    return { success: true, output: `Message sent via ${channel}.` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('not registered') || msg.includes('is not registered')) {
      return sendDirect(channel, messageText, attachment, caption, subject, recipient, context);
    }
    return { success: false, output: `Failed to send ${channel} message: ${msg}`, error: 'SEND_ERROR' };
  }
}

// Telegram
export async function telegramSendMessage(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;
  const recipient = args['chat_id'] as string | undefined;
  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('telegram', context, message, undefined, undefined, recipient);
}

export async function telegramSendFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = args['path'] as string;
  const caption = (args['caption'] as string | undefined) || (args['message'] as string | undefined);
  const recipient = args['chat_id'] as string | undefined;
  if (!path) {
    return { success: false, output: 'path is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('telegram', context, '', path, caption, recipient);
}

// Slack
export async function slackSendMessage(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;
  const recipient = args['channel'] as string | undefined;
  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('slack', context, message, undefined, undefined, recipient);
}

export async function slackSendFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = args['path'] as string;
  const title = (args['title'] as string | undefined) || (args['message'] as string | undefined);
  const recipient = args['channel'] as string | undefined;
  if (!path) {
    return { success: false, output: 'path is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('slack', context, title ?? '', path, title, recipient);
}

// Discord
export async function discordSendMessage(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;
  const recipient = args['channel_id'] as string | undefined;
  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('discord', context, message, undefined, undefined, recipient);
}

export async function discordSendFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = args['path'] as string;
  const message = (args['message'] as string | undefined) || (args['caption'] as string | undefined);
  const recipient = args['channel_id'] as string | undefined;
  if (!path) {
    return { success: false, output: 'path is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('discord', context, message ?? '', path, message, recipient);
}

// Email
export async function emailSendMessage(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;
  const to = args['to'] as string | undefined;
  const subject = args['subject'] as string | undefined;
  if (!message) {
    return { success: false, output: 'message is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('email', context, message, undefined, undefined, to, subject);
}

export async function emailSendFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = args['path'] as string;
  const to = args['to'] as string | undefined;
  const subject = args['subject'] as string | undefined;
  const body = (args['body'] as string | undefined) || (args['message'] as string | undefined);
  if (!path) {
    return { success: false, output: 'path is required', error: 'MISSING_INPUT' };
  }
  return sendToChannel('email', context, body ?? '', path, body, to, subject);
}
