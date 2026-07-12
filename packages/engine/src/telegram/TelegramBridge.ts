import { getLogger } from '@agentx/shared';
import type { EngineEvent } from '@agentx/shared';
import type { Agent } from '../agent/Agent.js';
import { AgentEventBus } from '../EventBus.js';
import { TelegramStore } from './TelegramStore.js';
import { randomBytes } from 'node:crypto';

export interface TelegramConfig {
  botToken: string;
  allowedUserIds?: number[];
  webhookUrl?: string;
  webhookSecret?: string;
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
  private isPolling = false;
  private lastUpdateId = 0;
  private messageCount = 0;
  private botUsername?: string;
  private connected = false;
  private commandHandler: ((cmd: string, args: string[], chatId: number) => Promise<string | null>) | null = null;
  private callbackHandlers: Map<string, (data: string, chatId: number, fromUserId?: number) => void> = new Map();
  private messageHandler: ((text: string, chatId: number) => void) | null = null;
  private fileHandler: ((fileId: string, fileName: string, mimeType: string, caption: string | undefined, chatId: number) => void) | null = null;
  /** Fired once when the first private DM claims an empty allowlist (sole owner). */
  private ownerClaimHandler: ((userId: number, chatId: number) => void) | null = null;
  private webhookSecret: string | null = null;
  
  // Message queue to prevent TOCTOU races
  private messageQueue: Array<{ text: string; chatId: number; resolve: (response: string) => void; reject: (error: Error) => void }> = [];
  private processingQueue = false;

  // ─── Flood protection (3-strike breaker) ───
  private floodStrikes = 0;
  private lastMessageTime = 0;
  private readonly MAX_FLOOD_STRIKES = 3;
  private lastFromIdByChat = new Map<number, number>();
  private readonly FLOOD_WINDOW_MS = 1000; // 1 message per second max

  constructor(config: TelegramConfig) {
    this.config = config;
    this.eventBus = new AgentEventBus();
  }

  getLastFromId(chatId: number): number | undefined {
    return this.lastFromIdByChat.get(chatId);
  }

  /**
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

  /** Replace the inbound allowlist (single owner after verify). */
  setAllowedUserIds(ids: number[]): void {
    this.config.allowedUserIds = ids;
  }

  getAllowedUserIds(): number[] {
    return this.config.allowedUserIds ?? [];
  }

  /** Persist sole owner when the first private DM claims an empty allowlist. */
  setOwnerClaimHandler(handler: ((userId: number, chatId: number) => void) | null): void {
    this.ownerClaimHandler = handler;
  }

  /**
   * Single-owner ACL. Empty allowlist + private DM → claim that user as sole owner
   * (wizard / first-link bootstrap). Otherwise only the linked owner is accepted.
   */
  private authorizeInbound(fromId: number | undefined, chatId: number, chatType?: string): boolean {
    const allowed = this.config.allowedUserIds ?? [];
    if (fromId && allowed.includes(fromId)) return true;

    if (allowed.length === 0 && fromId && chatType === 'private') {
      this.config.allowedUserIds = [fromId];
      try {
        this.ownerClaimHandler?.(fromId, chatId);
      } catch (e) {
        getLogger().warn('TELEGRAM', `Owner claim persist failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      getLogger().info('TELEGRAM', `Linked owner userId=${fromId} via first private DM`);
      return true;
    }

    return false;
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
    // Register as the globally active bridge for tool access
    _setActiveTelegramBridge(this);

    // Restore lastUpdateId from disk to prevent message replay on restart
    await this.restoreLastUpdateId();

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
   * Get the webhook secret for validating incoming requests.
   * If no secret was configured, generates a secure random secret.
   */
  getWebhookSecret(): string {
    if (!this.webhookSecret) {
      if (this.config.webhookSecret) {
        this.webhookSecret = this.config.webhookSecret;
      } else {
        // Generate a secure random secret if none provided
        this.webhookSecret = randomBytes(32).toString('hex');
      }
    }
    return this.webhookSecret ?? '';
  }

  /**
   * Set up webhook mode — registers the URL with Telegram.
   * The caller must handle incoming POST requests and pass them to handleWebhookUpdate().
   */
  private async setupWebhook(url: string): Promise<void> {
    const secretToken = this.getWebhookSecret();
    const result = await this.apiCall('setWebhook', {
      url,
      secret_token: secretToken,
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
   * @param update - The webhook payload from Telegram
   * @param secretToken - The X-Telegram-Bot-Api-Secret-Token header value (for validation)
   */
  async handleWebhookUpdate(update: Record<string, unknown>, secretToken?: string): Promise<void> {
    if (!this.connected) return;

    // Validate webhook secret token to ensure request came from Telegram
    if (this.webhookSecret && secretToken !== this.webhookSecret) {
      throw new Error('Invalid webhook secret token - request rejected');
    }

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
   * Returns true if the bridge is actively running.
   */
  isRunning(): boolean {
    return this.connected && this.polling;
  }

  /**
   * Stop the bot.
   */
  stop(): void {
    this.polling = false;
    this.connected = false;
    _clearActiveTelegramBridge();
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

  private credentialStore: TelegramStore | null = null;

  setCredentialStore(store: TelegramStore): void {
    this.credentialStore = store;
  }

  private async persistLastUpdateId(): Promise<void> {
    try {
      if (!this.credentialStore) return;
      const config = await this.credentialStore.load();
      if (config) {
        config.lastUpdateId = this.lastUpdateId;
        await this.credentialStore.save(config);
      }
    } catch {
      // Best effort — non-critical
    }
  }

  private async restoreLastUpdateId(): Promise<void> {
    try {
      if (!this.credentialStore) return;
      const config = await this.credentialStore.load();
      if (config?.lastUpdateId) {
        this.lastUpdateId = config.lastUpdateId;
      }
    } catch {
      // Best effort — fresh start
    }
  }

  private async poll(): Promise<void> {
    if (!this.polling || this.isPolling) return;
    
    this.isPolling = true;
    
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
        // Persist lastUpdateId to prevent message replay on restart
        await this.persistLastUpdateId();
      }
    } catch (error) {
      // Emit error but continue polling
      this.eventBus.emit({
        type: 'error',
        code: 'TELEGRAM_POLL_ERROR',
        message: error instanceof Error ? error.message : 'Polling error',
        recoverable: true,
      } as EngineEvent);
    } finally {
      this.isPolling = false;
      
      // Schedule next poll
      if (this.polling) {
        this.pollTimeout = setTimeout(() => this.poll(), 100);
      }
    }
  }

  private async handleMessage(msg: Record<string, any>): Promise<void> {
    const chatId = msg.chat?.id as number;
    const fromId = msg.from?.id as number | undefined;
    if (!chatId) return;

    // ─── Flood protection: 3-strike breaker ───
    const now = Date.now();
    if (now - this.lastMessageTime < this.FLOOD_WINDOW_MS) {
      this.floodStrikes++;
      if (this.floodStrikes >= this.MAX_FLOOD_STRIKES) {
        await this.sendMessage(chatId, '⚠️ Rate limit exceeded. Please wait before sending more messages.');
        return;
      }
    } else {
      this.floodStrikes = Math.max(0, this.floodStrikes - 1);
    }
    this.lastMessageTime = now;
    if (fromId) this.lastFromIdByChat.set(chatId, fromId);

    // Single-owner ACL: linked owner only. Empty allowlist + private DM claims owner.
    const chatType = typeof msg.chat?.type === 'string' ? msg.chat.type : undefined;
    if (!this.authorizeInbound(fromId, chatId, chatType)) {
      if ((this.config.allowedUserIds ?? []).length > 0) {
        await this.sendMessage(chatId, '⚠️ Unauthorized. This bot is restricted to its linked owner.');
      }
      return;
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

    getLogger().info('TELEGRAM', `Bridge received chat=${chatId} len=${text.length}${text.startsWith('/') ? ' (command)' : ''}`);

    // Intercept /commands if a handler is registered
    if (this.commandHandler && text.startsWith('/')) {
      const [cmd, ...args] = text.slice(1).split(/\s+/);
      if (cmd) {
        try {
          const response = await this.commandHandler(cmd, args, chatId);
          if (response !== null && response !== undefined) {
            await this.sendMessage(chatId, response);
          }
        } catch { /* fall through to agent */ }
        // Commands handled — skip agent processing
        return;
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

      // Queue the message instead of busy-waiting
      const response = await this.queueMessage(text, chatId);
      
      if (response) {
        await this.sendMessage(chatId, response);
      } else {
        await this.sendMessage(chatId, '(No response generated)');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Processing failed';
      await this.sendMessage(chatId, `❌ Error: ${errMsg}`);
    }
  }

  /**
   * Queue a message for processing to prevent TOCTOU races.
   * Returns a promise that resolves with the agent's response.
   */
  private queueMessage(text: string, chatId: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.messageQueue.push({ text, chatId, resolve, reject });
      this.processMessageQueue();
    });
  }

  /**
   * Process queued messages sequentially to prevent concurrent processing.
   */
  private async processMessageQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.messageQueue.length > 0) {
      const { text, chatId, resolve, reject } = this.messageQueue.shift()!;
      
      if (!this.agent) {
        reject(new Error('Agent not attached'));
        continue;
      }

      try {
        await this.apiCall('sendChatAction', { chat_id: chatId, action: 'typing' });
        const response = await this.agent.sendMessage(text);
        resolve(response.content || '');
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.processingQueue = false;
  }

  /**
   * Handle inline keyboard callback queries.
   */
  private async handleCallbackQuery(query: { id: string; data?: string; message?: { chat: { id: number } }; from?: { id: number } }): Promise<void> {
    const data = query.data;
    const chatId = query.message?.chat?.id;
    if (!data || !chatId) return;

    const fromId = query.from?.id;
    // Callbacks are private-chat UX; claim owner if allowlist empty, else enforce.
    if (!this.authorizeInbound(fromId, chatId, 'private')) {
      if ((this.config.allowedUserIds ?? []).length > 0) {
        await this.apiCall('answerCallbackQuery', {
          callback_query_id: query.id,
          text: 'Unauthorized',
          show_alert: true,
        });
      }
      return;
    }

    // Acknowledge the callback to remove loading indicator
    await this.apiCall('answerCallbackQuery', { callback_query_id: query.id });

    // Find handler by prefix (format: "prefix:payload")
    const [prefix] = data.split(':');
    if (prefix) {
      const handler = this.callbackHandlers.get(prefix);
      if (handler) {
        handler(data, chatId, query.from?.id);
        return;
      }
    }
  }

  /**
   * Register a callback query handler for a given prefix.
   * When a button with callback_data starting with "prefix:" is pressed, handler is called.
   */
  onCallback(prefix: string, handler: (data: string, chatId: number, fromUserId?: number) => void): void {
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

  /** Refresh Telegram "typing…" indicator (expires after ~5s). */
  async sendChatAction(chatId: number, action: 'typing' | 'upload_document' = 'typing'): Promise<void> {
    await this.apiCall('sendChatAction', { chat_id: chatId, action });
  }

  /** Send plain text without Markdown parsing; returns message_id for edits. */
  async sendPlainMessage(chatId: number, text: string): Promise<number | null> {
    const result = await this.apiCall('sendMessage', { chat_id: chatId, text });
    if (!result.ok) {
      throw new Error(result.description ?? 'Failed to send Telegram message');
    }
    return (result.result?.message_id as number | undefined) ?? null;
  }

  async editMessageText(chatId: number, messageId: number, text: string): Promise<boolean> {
    const result = await this.apiCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
    });
    if (result.ok) return true;
    if (result.description?.includes('message is not modified')) return true;
    getLogger().warn('TELEGRAM', `editMessageText failed: ${result.description ?? 'unknown error'}`);
    return false;
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    const result = await this.apiCall('deleteMessage', { chat_id: chatId, message_id: messageId });
    if (!result.ok && !result.description?.includes('message to delete not found')) {
      getLogger().warn('TELEGRAM', `deleteMessage failed: ${result.description ?? 'unknown error'}`);
    }
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
   * Send a message with inline keyboard buttons (single row).
   */
  async sendWithButtons(chatId: number, text: string, buttons: Array<{ text: string; callbackData: string }>): Promise<void> {
    await this.sendWithButtonRows(chatId, text, [buttons]);
  }

  /**
   * Send a message with inline keyboard button rows. Returns message_id when available.
   */
  async sendWithButtonRows(
    chatId: number,
    text: string,
    rows: Array<Array<{ text: string; callbackData: string }>>,
  ): Promise<number | null> {
    const inlineKeyboard = rows.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    );
    const result = await this.apiCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
    if (!result.ok && result.description?.includes('parse')) {
      const plain = await this.apiCall('sendMessage', {
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
      if (!plain.ok) {
        throw new Error(plain.description ?? 'Failed to send Telegram message with buttons');
      }
      return (plain.result?.message_id as number | undefined) ?? null;
    }
    if (!result.ok) {
      throw new Error(result.description ?? 'Failed to send Telegram message with buttons');
    }
    return (result.result?.message_id as number | undefined) ?? null;
  }

  /** Edit message text and inline keyboard rows. */
  async editMessageButtonRows(
    chatId: number,
    messageId: number,
    text: string,
    rows: Array<Array<{ text: string; callbackData: string }>>,
  ): Promise<boolean> {
    const inlineKeyboard = rows.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    );
    const result = await this.apiCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
    if (result.ok) return true;
    if (result.description?.includes('message is not modified')) return true;
    if (result.description?.includes('parse')) {
      const plain = await this.apiCall('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
      if (plain.ok) return true;
      if (plain.description?.includes('message is not modified')) return true;
    }
    getLogger().warn('TELEGRAM', `editMessageButtonRows failed: ${result.description ?? 'unknown error'}`);
    return false;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
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
      const result = await this.apiCall('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
      if (!result.ok) {
        if (result.description?.includes('parse')) {
          const plain = await this.apiCall('sendMessage', { chat_id: chatId, text: chunk });
          if (!plain.ok) {
            throw new Error(plain.description ?? 'Failed to send Telegram message');
          }
        } else {
          throw new Error(result.description ?? 'Failed to send Telegram message');
        }
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

  async sendVoice(chatId: number, filePath: string, caption?: string): Promise<{ ok: boolean; description?: string }> {
    const { statSync, readFileSync } = await import('node:fs');
    const { basename } = await import('node:path');

    const stat = statSync(filePath);
    if (stat.size > 50 * 1024 * 1024) {
      return { ok: false, description: 'Voice reply exceeds Telegram 50MB limit' };
    }

    const url = `https://api.telegram.org/bot${this.config.botToken}/sendVoice`;
    const fileBuffer = readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: 'audio/ogg' });
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('voice', blob, basename(filePath));
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

// ─── Global active bridge singleton (for tool access) ───

let _activeBridge: TelegramBridge | null = null;

function _setActiveTelegramBridge(bridge: TelegramBridge): void {
  _activeBridge = bridge;
}

function _clearActiveTelegramBridge(): void {
  _activeBridge = null;
}

export function getActiveTelegramBridge(): TelegramBridge | null {
  return _activeBridge;
}
