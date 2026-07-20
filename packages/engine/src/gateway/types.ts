import type { VisualUpdate } from '@agentx/shared';
import type { FocusState } from './FocusManager.js';

export interface ChannelPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;

  /** Called when the plugin is loaded into the gateway */
  onLoad?(): Promise<void>;

  /** Called when the plugin is started (activated) */
  onStart?(): Promise<void>;

  /** Called when the plugin is stopped */
  onStop?(): Promise<void>;

  /** Process an incoming message from the channel → returns structured text */
  handleIncoming(payload: Record<string, unknown>): Promise<{ text: string; userId: string; channelId: string }>;

  /** Format an outgoing response for the channel */
  handleOutgoing(text: string, metadata: Record<string, unknown>): Promise<Record<string, unknown>>;

  /** Format a visual update for the channel */
  handleVisualUpdate?(update: VisualUpdate): Promise<Record<string, unknown> | null>;

  /** Send a raw message directly to the channel (e.g., typing indicator, error) */
  sendRaw?(channelId: string, message: string): Promise<void>;

  /** Get current focus state of this channel */
  getFocusState?(): FocusState;
}

export interface GatewayConfig {
  port: number;
  host: string;
  maxConcurrentSessions: number;
  authRequired: boolean;
}

export interface ChannelRegistryEntry {
  plugin: ChannelPlugin;
  enabled: boolean;
  stats: {
    messagesReceived: number;
    messagesSent: number;
    errors: number;
    lastActivity: number;
  };
}

export interface ChannelMessage {
  text: string;
  userId: string;
  channelId: string;
  metadata?: Record<string, unknown>;
  attachments?: ChannelAttachment[];
}

export interface ChannelAttachment {
  id: string;
  type: 'file' | 'image' | 'url';
  name: string;
  mimeType?: string;
  data?: string;
  url?: string;
}

export interface GatewayResponse {
  text: string;
  channels: string[];
  metadata?: Record<string, unknown>;
}
