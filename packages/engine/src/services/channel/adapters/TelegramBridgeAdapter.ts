import { TelegramBridge, type TelegramBridgeStatus, type TelegramConfig } from '../../../telegram/TelegramBridge.js';
import type { Agent } from '../../../agent/Agent.js';
import type { OutboundMessage, ChannelStatus } from '../IChannelService.js';
import type { IChannelBridge, OnInboundCallback } from '../IChannelBridge.js';

export interface TelegramBridgeAdapterConfig {
  bridge?: TelegramBridge;
  telegramConfig?: TelegramConfig;
  chatId?: string | number;
}

/**
 * Thin IChannelBridge adapter around the TelegramBridge.
 */
export class TelegramBridgeAdapter implements IChannelBridge {
  private readonly bridge: TelegramBridge;
  private readonly chatId?: string | number;

  constructor(options: TelegramBridgeAdapterConfig = {}) {
    this.bridge = options.bridge ?? new TelegramBridge(options.telegramConfig ?? { botToken: '' });
    this.chatId = options.chatId;
  }

  async start(onInbound: OnInboundCallback): Promise<void> {
    // Attach a placeholder agent so the bridge's message handler path is used.
    this.bridge.attach({} as unknown as Agent);

    this.bridge.setMessageHandler((text: string, chatId: number) => {
      const fromId = this.bridge.getLastFromId(chatId);
      void onInbound('telegram', {
        channel: 'telegram',
        sender: { id: String(fromId ?? chatId), name: 'unknown' },
        text,
        threadId: String(chatId),
        raw: { chatId, text, fromId },
        timestamp: new Date().toISOString(),
      });
    });

    this.bridge.setFileHandler((fileId: string, fileName: string, mimeType: string, caption: string | undefined, chatId: number) => {
      const fromId = this.bridge.getLastFromId(chatId);
      const text = caption ? `${caption}\n[file: ${fileName} (${mimeType})]` : `[file: ${fileName} (${mimeType})]`;
      void onInbound('telegram', {
        channel: 'telegram',
        sender: { id: String(fromId ?? chatId), name: 'unknown' },
        text,
        threadId: String(chatId),
        raw: { chatId, fileId, fileName, mimeType, caption },
        timestamp: new Date().toISOString(),
      });
    });

    await this.bridge.start();
  }

  async stop(): Promise<void> {
    this.bridge.stop();
  }

  async send(message: OutboundMessage): Promise<void> {
    const rawId = message.threadId ?? this.chatId;
    if (!rawId) {
      throw new Error('Telegram chat id is required to send a message');
    }
    const chatId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isFinite(chatId)) {
      throw new Error(`Invalid Telegram chat id: ${rawId}`);
    }
    await this.bridge.sendMessage(chatId, message.text);
  }

  getStatus(): ChannelStatus {
    const status = this.bridge.getStatus() as TelegramBridgeStatus;
    return {
      channel: 'telegram',
      connected: status.connected,
      details: { botUsername: status.botUsername, lastActivity: status.lastActivity, messageCount: status.messageCount },
    };
  }
}
