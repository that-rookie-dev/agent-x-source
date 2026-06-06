import type { Agent } from '../agent/Agent.js';
import { ChannelRegistry } from './ChannelRegistry.js';
import { FocusManager } from './FocusManager.js';
import type { FocusChangeEvent } from './FocusManager.js';
import { TelegramChannelPlugin } from './plugins/TelegramChannelPlugin.js';
import { WebSocketChannelPlugin } from './plugins/WebSocketChannelPlugin.js';
import type { GatewayConfig, ChannelPlugin } from './types.js';
import { getLogger } from '@agentx/shared';

export class Gateway {
  readonly registry = new ChannelRegistry();
  readonly focus = new FocusManager();
  private config: GatewayConfig;
  private agentRef: Agent | null = null;


  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = {
      port: config.port ?? 18789,
      host: config.host ?? '127.0.0.1',
      maxConcurrentSessions: config.maxConcurrentSessions ?? 4,
      rateLimitPerMinute: config.rateLimitPerMinute ?? 30,
      authRequired: config.authRequired ?? false,
    };

    this.registry.register(new WebSocketChannelPlugin());
    this.focus.onFocusChange((event: FocusChangeEvent) => {
      getLogger().info('GATEWAY', `Focus switched: ${event.previousChannelId} → ${event.channelId}`);
    });
  }

  /** Attach to an Agent instance so channels can route messages to it */
  attachAgent(agent: Agent): void {
    this.agentRef = agent;
    this.registry.setAgent(agent);
  }

  getAgent(): Agent | null {
    return this.agentRef;
  }

  /** Register a Telegram channel with the given bot token */
  registerTelegram(botToken: string, allowedUserIds?: number[]): TelegramChannelPlugin {
    const plugin = new TelegramChannelPlugin({ botToken, allowedUserIds });
    plugin.setFocusManager(this.focus);
    this.registry.register(plugin);
    this.focus.registerChannel(plugin.id);
    return plugin;
  }

  /** Register a custom channel plugin */
  registerChannel(plugin: ChannelPlugin): void {
    this.registry.register(plugin);
    this.focus.registerChannel(plugin.id);
  }

  /** Start a specific channel */
  async startChannel(channelId: string): Promise<void> {
    await this.registry.startChannel(channelId);
  }

  /** Stop a specific channel */
  async stopChannel(channelId: string): Promise<void> {
    await this.registry.stopChannel(channelId);
    this.focus.unregisterChannel(channelId);
  }

  /** Start all registered channels */
  async startAll(): Promise<void> {
    const channels = this.registry.listChannels();
    for (const ch of channels) {
      try {
        await this.registry.startChannel(ch.id);
      } catch (err) {
        getLogger().error('GATEWAY', `Failed to start channel ${ch.id}: ${err}`);
      }
    }
  }

  /** Stop all channels */
  async stopAll(): Promise<void> {
    const channels = this.registry.listChannels();
    for (const ch of channels) {
      try {
        await this.registry.stopChannel(ch.id);
      } catch {}
    }
    for (const ch of this.focus.getAllChannels()) {
      this.focus.unregisterChannel(ch);
    }
  }

  /**
   * Handle an incoming message from any channel.
   * Routes to the agent and sends response to the appropriate channel(s).
   */
  async handleIncomingMessage(channelId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.agentRef) {
      getLogger().error('GATEWAY', 'No agent attached to gateway');
      return;
    }

    this.focus.onActivity(channelId);

    const entry = this.registry.getChannel(channelId);
    if (!entry || !entry.enabled) {
      getLogger().warn('GATEWAY', `Message from disabled channel: ${channelId}`);
      return;
    }

    entry.stats.messagesReceived++;
    entry.stats.lastActivity = Date.now();

    try {
      // Use the plugin's handleIncoming to parse the message
      const parsed = await entry.plugin.handleIncoming(payload);
      const { text, userId, channelId: parsedChannelId } = parsed;

      // Pass the parsed message with metadata to the agent
      await this.agentRef.sendMessage(text, {
        userId,
        channelId: parsedChannelId,
        sourceChannel: channelId,
      });
    } catch (err) {
      entry.stats.errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      getLogger().error('GATEWAY', `Agent processing error: ${errMsg}`);

      const focusedId = this.focus.getFocus();
      if (focusedId) {
        const focusedEntry = this.registry.getChannel(focusedId);
        if (focusedEntry?.plugin.sendRaw) {
          await focusedEntry.plugin.sendRaw(channelId, `⚠️ Error: ${errMsg}`);
        }
      }
    }
  }

  /**
   * Route an outgoing response to the focused channel (or all active channels).
   */
  async sendResponse(text: string, sourceChannelId?: string): Promise<void> {
    let targetChannels: string[];

    // Coherent routing: source channel takes priority (where the message came from)
    if (sourceChannelId) {
      const sourceEntry = this.registry.getChannel(sourceChannelId);
      if (sourceEntry?.enabled) {
        targetChannels = [sourceChannelId];
      } else if (this.focus.hasActiveFocus()) {
        // Fallback to focused channel if source is disabled
        const focusedId = this.focus.getFocus()!;
        targetChannels = [focusedId];
      } else {
        // Last resort: broadcast to all active channels
        targetChannels = this.focus.getActiveChannels();
      }
    } else if (this.focus.hasActiveFocus()) {
      const focusedId = this.focus.getFocus()!;
      targetChannels = [focusedId];
    } else {
      targetChannels = this.focus.getActiveChannels();
    }

    for (const chId of targetChannels) {
      const entry = this.registry.getChannel(chId);
      if (!entry || !entry.enabled) continue;

      try {
        await entry.plugin.handleOutgoing(text, { sourceChannelId });
        entry.stats.messagesSent++;
        entry.stats.lastActivity = Date.now();
      } catch (err) {
        entry.stats.errors++;
        getLogger().error('GATEWAY', `Failed to send to channel ${chId}: ${err}`);
      }
    }
  }

  /**
   * Broadcast a message to all enabled channels regardless of focus.
   */
  async broadcast(text: string, excludeChannelId?: string): Promise<void> {
    const channels = this.registry.listChannels();
    for (const ch of channels) {
      if (!ch.enabled || ch.id === excludeChannelId) continue;
      const entry = this.registry.getChannel(ch.id);
      if (!entry) continue;
      try {
        await entry.plugin.handleOutgoing(text, { broadcast: true });
        entry.stats.messagesSent++;
      } catch {}
    }
  }

  getConfig(): GatewayConfig {
    return { ...this.config };
  }

  /** Get the underlying Telegram bridge (for backward compatibility) */
  getTelegramBridge(): import('../telegram/TelegramBridge.js').TelegramBridge | null {
    const entry = this.registry.getChannel('telegram');
    if (entry?.plugin instanceof TelegramChannelPlugin) {
      return entry.plugin.getBridge();
    }
    return null;
  }

  isHealthy(): boolean {
    return this.agentRef !== null;
  }
}
