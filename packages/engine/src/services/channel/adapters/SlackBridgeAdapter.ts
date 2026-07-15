import { SlackBridge, type SlackBridgeStatus, type SlackConfig } from '../../../slack/SlackBridge.js';
import type { OutboundMessage, ChannelStatus } from '../IChannelService.js';
import type { IChannelBridge, OnInboundCallback } from '../IChannelBridge.js';

export interface SlackBridgeAdapterConfig {
  bridge?: SlackBridge;
  slackConfig?: SlackConfig;
  defaultChannel?: string;
  allowedUserIds?: string[];
}

/**
 * Thin IChannelBridge adapter around the SlackBridge.
 */
export class SlackBridgeAdapter implements IChannelBridge {
  private readonly bridge: SlackBridge;
  private readonly defaultChannel?: string;
  private readonly allowedUserIds: string[];

  constructor(options: SlackBridgeAdapterConfig = {}) {
    this.bridge = options.bridge ?? new SlackBridge(options.slackConfig ?? { botToken: '', appToken: '' });
    this.defaultChannel = options.defaultChannel;
    this.allowedUserIds = options.allowedUserIds ?? [];
  }

  async start(onInbound: OnInboundCallback): Promise<void> {
    this.bridge.setAllowedUserIds(this.allowedUserIds);
    this.bridge.setMessageHandler((event: { userId: string; channel: string; text: string; messageTs: string; threadTs?: string }) => {
      void onInbound('slack', {
        channel: 'slack',
        sender: { id: event.userId, name: 'unknown' },
        text: event.text,
        threadId: event.channel,
        messageId: event.threadTs ?? event.messageTs,
        raw: event,
        timestamp: new Date().toISOString(),
      });
    });
    await this.bridge.start();
  }

  async stop(): Promise<void> {
    await this.bridge.stop();
  }

  async send(message: OutboundMessage): Promise<void> {
    const channel = message.threadId ?? this.defaultChannel;
    if (!channel) {
      throw new Error('Slack channel is required to send a message');
    }
    await this.bridge.sendMessage(channel, message.text, message.replyTo);
  }

  getStatus(): ChannelStatus {
    const status = this.bridge.getStatus() as SlackBridgeStatus;
    return {
      channel: 'slack',
      connected: status.connected,
      details: { configured: status.configured, team: status.team },
    };
  }
}
