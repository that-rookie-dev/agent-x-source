import { DiscordBridge, type DiscordBridgeStatus, type DiscordConfig } from '../../../discord/DiscordBridge.js';
import type { OutboundMessage, ChannelStatus } from '../IChannelService.js';
import type { IChannelBridge, OnInboundCallback } from '../IChannelBridge.js';

export interface DiscordBridgeAdapterConfig {
  bridge?: DiscordBridge;
  discordConfig?: DiscordConfig;
  allowedUserIds?: string[];
}

/**
 * Thin IChannelBridge adapter around the DiscordBridge.
 */
export class DiscordBridgeAdapter implements IChannelBridge {
  private readonly bridge: DiscordBridge;
  private readonly config: DiscordConfig;
  private readonly allowedUserIds: string[];

  constructor(options: DiscordBridgeAdapterConfig = {}) {
    this.bridge = options.bridge ?? new DiscordBridge();
    this.config = options.discordConfig ?? { botToken: '' };
    this.allowedUserIds = options.allowedUserIds ?? [];
  }

  async start(onInbound: OnInboundCallback): Promise<void> {
    this.bridge.setAllowedUserIds(this.allowedUserIds);
    this.bridge.setMessageHandler((text: string, userId: string, channelId: string) => {
      void onInbound('discord', {
        channel: 'discord',
        sender: { id: userId, name: 'unknown' },
        text,
        threadId: channelId,
        raw: { userId, channelId, text },
        timestamp: new Date().toISOString(),
      });
    });
    await this.bridge.start(this.config.botToken, this.config.channelId);
  }

  async stop(): Promise<void> {
    this.bridge.stop();
  }

  async send(message: OutboundMessage): Promise<void> {
    const channelId = message.threadId ?? this.config.channelId;
    if (!channelId) {
      throw new Error('Discord channel id is required to send a message');
    }
    await this.bridge.sendMessage(channelId, message.text);
  }

  getStatus(): ChannelStatus {
    const status = this.bridge.getStatus() as DiscordBridgeStatus;
    return {
      channel: 'discord',
      connected: status.connected,
      details: { botUsername: status.botUsername, guilds: status.guilds, messageCount: status.messageCount },
    };
  }
}
