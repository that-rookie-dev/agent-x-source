import type { EngineEvent } from '@agentx/shared';
import type { Agent } from '../agent/Agent.js';
import { AgentEventBus } from '../EventBus.js';

export interface TelegramConfig {
  botToken: string;
  allowedUserIds?: number[];
  webhookUrl?: string;
}

export interface TelegramBridgeStatus {
  connected: boolean;
  botUsername?: string;
  lastActivity?: string;
  messageCount: number;
}

/**
 * Telegram bot bridge that connects Agent-X to Telegram via polling or webhook.
 * Uses the Telegram Bot HTTP API directly (no dependency on node-telegram-bot-api).
 */
export class TelegramBridge {
  private config: TelegramConfig;
  private agent: Agent | null = null;
  private eventBus: AgentEventBus;
  private polling = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateId = 0;
  private messageCount = 0;
  private botUsername?: string;
  private connected = false;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.eventBus = new AgentEventBus();
  }

  /**
   * Connect this bridge to an Agent instance for message processing.
   */
  attach(agent: Agent): void {
    this.agent = agent;
  }

  /**
   * Start the Telegram bot (long-polling mode).
   */
  async start(): Promise<void> {
    // Verify token by calling getMe
    const me = await this.apiCall('getMe');
    if (!me.ok) {
      throw new Error(`Telegram bot token invalid: ${me.description ?? 'Unknown error'}`);
    }
    this.botUsername = me.result.username;
    this.connected = true;
    this.polling = true;
    this.poll();
  }

  /**
   * Stop the bot.
   */
  stop(): void {
    this.polling = false;
    this.connected = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  getStatus(): TelegramBridgeStatus {
    return {
      connected: this.connected,
      botUsername: this.botUsername,
      messageCount: this.messageCount,
    };
  }

  get events(): AgentEventBus {
    return this.eventBus;
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;

    try {
      const updates = await this.apiCall('getUpdates', {
        offset: this.lastUpdateId + 1,
        timeout: 30,
        allowed_updates: ['message'],
      });

      if (updates.ok && updates.result?.length > 0) {
        for (const update of updates.result) {
          this.lastUpdateId = update.update_id;
          if (update.message?.text) {
            await this.handleMessage(update.message);
          }
        }
      }
    } catch (error) {
      // Emit error but continue polling
      this.eventBus.emit({
        type: 'error',
        code: 'TELEGRAM_POLL_ERROR',
        message: error instanceof Error ? error.message : 'Polling error',
        recoverable: true,
      } as EngineEvent);
    }

    // Schedule next poll
    if (this.polling) {
      this.pollTimeout = setTimeout(() => this.poll(), 100);
    }
  }

  private async handleMessage(msg: { chat: { id: number }; from?: { id: number }; text: string }): Promise<void> {
    // Check if user is allowed
    if (this.config.allowedUserIds?.length) {
      if (!msg.from || !this.config.allowedUserIds.includes(msg.from.id)) {
        await this.sendMessage(msg.chat.id, '⚠️ Unauthorized. This bot is restricted to specific users.');
        return;
      }
    }

    this.messageCount++;

    // Process through agent
    if (!this.agent) {
      await this.sendMessage(msg.chat.id, '⚠️ Agent not attached to Telegram bridge.');
      return;
    }

    try {
      // Send "typing" indicator
      await this.apiCall('sendChatAction', { chat_id: msg.chat.id, action: 'typing' });

      const response = await this.agent.sendMessage(msg.text);
      await this.sendMessage(msg.chat.id, response.content);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Processing failed';
      await this.sendMessage(msg.chat.id, `❌ Error: ${errMsg}`);
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    // Telegram has a 4096 character limit per message
    const maxLen = 4096;
    if (text.length <= maxLen) {
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      });
    } else {
      // Split into chunks
      const chunks = [];
      for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.slice(i, i + maxLen));
      }
      for (const chunk of chunks) {
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        });
      }
    }
  }

  private async apiCall(method: string, params?: Record<string, unknown>): Promise<any> {
    const url = `https://api.telegram.org/bot${this.config.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
      signal: AbortSignal.timeout(35_000),
    });
    return response.json();
  }
}
