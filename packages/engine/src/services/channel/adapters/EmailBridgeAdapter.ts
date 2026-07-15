import { EmailBridge, type EmailBridgeStatus, type EmailBridgeConfig, type ParsedEmail } from '../../../email/EmailBridge.js';
import type { OutboundMessage, ChannelStatus } from '../IChannelService.js';
import type { IChannelBridge, OnInboundCallback } from '../IChannelBridge.js';

export interface EmailBridgeAdapterConfig {
  bridge?: EmailBridge;
  emailConfig?: EmailBridgeConfig;
}

function extractEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) return match[1]!;
  const simple = fromHeader.trim();
  if (simple.includes('@')) return simple;
  return fromHeader;
}

/**
 * Thin IChannelBridge adapter around the EmailBridge.
 */
export class EmailBridgeAdapter implements IChannelBridge {
  private readonly bridge: EmailBridge;
  private readonly config: EmailBridgeConfig;

  constructor(options: EmailBridgeAdapterConfig = {}) {
    this.bridge = options.bridge ?? new EmailBridge();
    this.config = options.emailConfig ?? { smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', fromAddress: '' };
  }

  async start(onInbound: OnInboundCallback): Promise<void> {
    this.bridge.setMessageHandler((email: ParsedEmail) => {
      void onInbound('email', {
        channel: 'email',
        sender: { id: extractEmailAddress(email.from), name: email.from },
        text: email.text ?? email.html ?? '',
        messageId: email.messageId,
        raw: email,
        timestamp: email.date.toISOString(),
      });
    });
    await this.bridge.start(this.config);
  }

  async stop(): Promise<void> {
    this.bridge.stop();
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!message.to) {
      throw new Error('Email recipient (to) is required to send a message');
    }
    const subject = message.subject ?? 'No subject';
    if (message.replyTo) {
      await this.bridge.replyTo(message.replyTo, message.to, subject, message.text);
    } else {
      await this.bridge.sendEmail(message.to, subject, message.text);
    }
  }

  getStatus(): ChannelStatus {
    const status = this.bridge.getStatus() as EmailBridgeStatus;
    return {
      channel: 'email',
      connected: status.connected && status.imapConnected && status.smtpConnected,
      errors: status.lastError ? [status.lastError] : undefined,
      details: { configured: status.configured, unreadCount: status.unreadCount, imapConnected: status.imapConnected, smtpConnected: status.smtpConnected },
    };
  }
}
