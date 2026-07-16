import { readFileSync } from 'node:fs';
import { basename, extname, resolve, isAbsolute } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { isAgentInternalPath } from '@agentx/shared';
import { getChannelServiceInstance } from '../../services/ServiceContext.js';
import type { ChannelId, OutboundMessage } from '../../services/channel/IChannelService.js';

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
  if (activeChannel && activeChannel !== expectedChannel && !explicitRecipient) {
    // Same-channel default: use the active thread
    if (activeChannel && SUPPORTED_CHANNELS.includes(activeChannel)) {
      // User is on a different channel — they need to specify a recipient for the target channel
      return { channel: expectedChannel, error: `To send to ${expectedChannel} from ${activeChannel}, provide a recipient (chat_id, channel, or email address).` };
    }
  }
  const threadId = explicitRecipient ?? (activeChannel === expectedChannel ? context.sourceThreadId : undefined);
  return { channel: expectedChannel, threadId };
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
  const channelService = getChannelServiceInstance();
  if (!channelService) {
    return { success: false, output: 'Channel service is not initialized.', error: 'CHANNEL_SERVICE_UNAVAILABLE' };
  }

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

  try {
    await channelService.send(channel, message);
    return { success: true, output: `Message sent via ${channel}.` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
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
