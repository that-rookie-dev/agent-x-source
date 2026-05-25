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
  private commandHandler: ((cmd: string, args: string[], chatId: number) => Promise<string | null>) | null = null;
  private callbackHandlers: Map<string, (data: string, chatId: number) => void> = new Map();
  private messageHandler: ((text: string, chatId: number) => void) | null = null;
  private fileHandler: ((fileId: string, fileName: string, mimeType: string, caption: string | undefined, chatId: number) => void) | null = null;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.eventBus = new AgentEventBus();
  }

  /**
   * Register a handler for /commands received via Telegram.
   * If the handler returns a string, it's sent as a reply.
   * If it returns null, the message is passed to the agent.
   */
  setCommandHandler(handler: (cmd: string, args: string[], chatId: number) => Promise<string | null>): void {
    this.commandHandler = handler;
  }

  /**
   * Register a message handler that intercepts ALL non-command messages.
   * When set, the bridge will NOT call agent.sendMessage directly — instead it delegates to this handler.
   * The handler is responsible for processing the message and sending a response.
   */
  setMessageHandler(handler: (text: string, chatId: number) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Register a handler for file messages (documents, photos, audio, video).
   * Called with the Telegram file_id, file name, MIME type, optional caption, and chat ID.
   */
  setFileHandler(handler: (fileId: string, fileName: string, mimeType: string, caption: string | undefined, chatId: number) => void): void {
    this.fileHandler = handler;
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

    // Use webhook mode if configured, otherwise long-polling
    if (this.config.webhookUrl) {
      await this.setupWebhook(this.config.webhookUrl);
    } else {
      // Delete any existing webhook first to enable polling
      await this.apiCall('deleteWebhook');
      this.polling = true;
      this.poll();
    }
  }

  /**
   * Set up webhook mode — registers the URL with Telegram.
   * The caller must handle incoming POST requests and pass them to handleWebhookUpdate().
   */
  private async setupWebhook(url: string): Promise<void> {
    const result = await this.apiCall('setWebhook', {
      url,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    if (!result.ok) {
      throw new Error(`Failed to set webhook: ${result.description ?? 'Unknown error'}`);
    }
  }

  /**
   * Handle an incoming webhook update (POST body from Telegram).
   * Call this from your HTTP server handler when receiving webhook requests.
   */
  async handleWebhookUpdate(update: Record<string, unknown>): Promise<void> {
    if (!this.connected) return;
    const updateId = update['update_id'] as number;
    if (updateId) this.lastUpdateId = updateId;

    const callbackQuery = update['callback_query'] as { id: string; data?: string; message?: { chat: { id: number } }; from?: { id: number } } | undefined;
    if (callbackQuery) {
      await this.handleCallbackQuery(callbackQuery);
      return;
    }

    const message = update['message'] as Record<string, any> | undefined;
    if (message) {
      await this.handleMessage(message);
    }
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
        allowed_updates: ['message', 'callback_query'],
      });

      if (updates.ok && updates.result?.length > 0) {
        for (const update of updates.result) {
          this.lastUpdateId = update.update_id;
          if (update.callback_query) {
            await this.handleCallbackQuery(update.callback_query);
          } else if (update.message) {
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

  private async handleMessage(msg: Record<string, any>): Promise<void> {
    const chatId = msg.chat?.id as number;
    const fromId = msg.from?.id as number | undefined;
    if (!chatId) return;

    // Check if user is allowed
    if (this.config.allowedUserIds?.length) {
      if (!fromId || !this.config.allowedUserIds.includes(fromId)) {
        await this.sendMessage(chatId, '⚠️ Unauthorized. This bot is restricted to specific users.');
        return;
      }
    }

    this.messageCount++;

    // ─── Handle file messages (document, photo, audio, video, voice) ───
    const doc = msg.document as { file_id: string; file_name?: string; mime_type?: string } | undefined;
    const photo = msg.photo as Array<{ file_id: string; width: number; height: number }> | undefined;
    const audio = msg.audio as { file_id: string; file_name?: string; mime_type?: string } | undefined;
    const video = msg.video as { file_id: string; file_name?: string; mime_type?: string } | undefined;
    const voice = msg.voice as { file_id: string; mime_type?: string } | undefined;

    const fileInfo = doc
      ? { fileId: doc.file_id, fileName: doc.file_name ?? 'document', mimeType: doc.mime_type ?? 'application/octet-stream' }
      : photo?.length
        ? { fileId: photo[photo.length - 1]!.file_id, fileName: 'photo.jpg', mimeType: 'image/jpeg' }
        : audio
          ? { fileId: audio.file_id, fileName: audio.file_name ?? 'audio', mimeType: audio.mime_type ?? 'audio/mpeg' }
          : video
            ? { fileId: video.file_id, fileName: video.file_name ?? 'video.mp4', mimeType: video.mime_type ?? 'video/mp4' }
            : voice
              ? { fileId: voice.file_id, fileName: 'voice.ogg', mimeType: voice.mime_type ?? 'audio/ogg' }
              : null;

    if (fileInfo && this.fileHandler) {
      const caption = msg.caption as string | undefined;
      this.fileHandler(fileInfo.fileId, fileInfo.fileName, fileInfo.mimeType, caption, chatId);
      return;
    }

    // If file message but no handler, inform user
    if (fileInfo && !this.fileHandler) {
      await this.sendMessage(chatId, '⚠️ File receiving is not supported in this mode.');
      return;
    }

    const text = msg.text as string | undefined;
    if (!text) return;

    // Intercept /commands if a handler is registered
    if (this.commandHandler && text.startsWith('/')) {
      const [cmd, ...args] = text.slice(1).split(/\s+/);
      if (cmd) {
        try {
          const response = await this.commandHandler(cmd, args, chatId);
          if (response !== null) {
            await this.sendMessage(chatId, response);
            return;
          }
        } catch { /* fall through to agent */ }
      }
    }

    // Process through agent
    if (!this.agent) {
      await this.sendMessage(chatId, '⚠️ Agent not attached to Telegram bridge.');
      return;
    }

    // If a message handler is registered (e.g., daemon queue), delegate to it
    if (this.messageHandler) {
      await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' });
      this.messageHandler(text, chatId);
      return;
    }

    try {
      // Send "typing" indicator
      await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' });

      // Wait if agent is busy processing another message
      let waitAttempts = 0;
      while (this.agent.processing && waitAttempts < 60) {
        await new Promise((r) => setTimeout(r, 1000));
        await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' });
        waitAttempts++;
      }

      if (this.agent.processing) {
        await this.sendMessage(chatId, '⏳ Agent is busy. Please try again in a moment.');
        return;
      }

      const response = await this.agent.sendMessage(text);
      if (response.content) {
        await this.sendMessage(chatId, response.content);
      } else {
        await this.sendMessage(chatId, '(No response generated)');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Processing failed';
      await this.sendMessage(chatId, `❌ Error: ${errMsg}`);
    }
  }

  /**
   * Handle inline keyboard callback queries.
   */
  private async handleCallbackQuery(query: { id: string; data?: string; message?: { chat: { id: number } }; from?: { id: number } }): Promise<void> {
    const data = query.data;
    const chatId = query.message?.chat?.id;
    if (!data || !chatId) return;

    // Acknowledge the callback to remove loading indicator
    await this.apiCall('answerCallbackQuery', { callback_query_id: query.id });

    // Find handler by prefix (format: "prefix:payload")
    const [prefix] = data.split(':');
    if (prefix) {
      const handler = this.callbackHandlers.get(prefix);
      if (handler) {
        handler(data, chatId);
        return;
      }
    }
  }

  /**
   * Register a callback query handler for a given prefix.
   * When a button with callback_data starting with "prefix:" is pressed, handler is called.
   */
  onCallback(prefix: string, handler: (data: string, chatId: number) => void): void {
    this.callbackHandlers.set(prefix, handler);
  }

  /**
   * Remove a callback handler.
   */
  offCallback(prefix: string): void {
    this.callbackHandlers.delete(prefix);
  }

  /**
   * Send a message to a specific chat (public API for daemon use).
   */
  async sendToChat(chatId: number, text: string): Promise<void> {
    await this.sendMessage(chatId, text);
  }

  /**
   * Download a file from Telegram by file_id.
   * Returns the file contents as a Buffer.
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    // Step 1: Get file path from Telegram
    const fileInfo = await this.apiCall('getFile', { file_id: fileId });
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      throw new Error(`Failed to get file info: ${fileInfo.description ?? 'Unknown error'}`);
    }
    // Step 2: Download from Telegram's file server
    const downloadUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${fileInfo.result.file_path}`;
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`Failed to download file: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Send a message with inline keyboard buttons.
   */
  async sendWithButtons(chatId: number, text: string, buttons: Array<{ text: string; callbackData: string }>): Promise<void> {
    const inlineKeyboard = [buttons.map((b) => ({ text: b.text, callback_data: b.callbackData }))];
    const result = await this.apiCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
    if (!result.ok && result.description?.includes('parse')) {
      await this.apiCall('sendMessage', {
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    // Telegram has a 4096 character limit per message
    const maxLen = 4096;
    const chunks: string[] = [];
    if (text.length <= maxLen) {
      chunks.push(text);
    } else {
      for (let i = 0; i < text.length; i += maxLen) {
        chunks.push(text.slice(i, i + maxLen));
      }
    }

    for (const chunk of chunks) {
      // Try Markdown first, fall back to plain text if parsing fails
      const result = await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
      if (!result.ok && result.description?.includes('parse')) {
        // Markdown parsing failed — send as plain text
        await this.apiCall('sendMessage', {
          chat_id: chatId,
          text: chunk,
        });
      }
    }
  }

  /**
   * Send a file (document) to a specific chat.
   * Uses multipart/form-data to upload the file to Telegram.
   */
  async sendDocumentToChat(chatId: number, filePath: string, caption?: string): Promise<{ ok: boolean; description?: string }> {
    const { statSync, readFileSync } = await import('node:fs');
    const { basename } = await import('node:path');

    // Verify file exists and is reasonable size (Telegram limit: 50MB)
    const stat = statSync(filePath);
    if (stat.size > 50 * 1024 * 1024) {
      return { ok: false, description: 'File exceeds Telegram 50MB limit' };
    }

    const fileName = basename(filePath);
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendDocument`;

    const fileBuffer = readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });

    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('document', blob, fileName);
    if (caption) {
      formData.append('caption', caption.slice(0, 1024));
    }

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });
    return response.json() as Promise<{ ok: boolean; description?: string }>;
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
