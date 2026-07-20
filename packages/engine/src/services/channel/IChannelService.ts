/**
 * Channel identifiers supported by the engine channel service.
 */
export type ChannelId = 'telegram' | 'discord' | 'slack' | 'email';

/**
 * Generic attachment for outbound channel messages.
 */
export interface ChannelAttachment {
  name?: string;
  contentType?: string;
  url?: string;
  content?: string | Buffer | Uint8Array | unknown;
}

/**
 * Message sent from the engine to a channel bridge.
 */
export interface OutboundMessage {
  text: string;
  attachments?: ChannelAttachment[];
  threadId?: string;
  replyTo?: string;
  /** For email-style bridges the recipient and subject are required. */
  to?: string;
  subject?: string;
}

/**
 * Normalized payload produced when a channel bridge receives an inbound message.
 */
export interface InboundPayload {
  channel: ChannelId;
  sender: { id: string; name: string };
  text: string;
  raw: unknown;
  timestamp: string;
  /** Optional channel thread / conversation id for routing replies. */
  threadId?: string;
  /** Optional id of the inbound message, used for replying in email/Slack threads. */
  messageId?: string;
}

/**
 * Runtime status snapshot for a single channel.
 */
export interface ChannelStatus {
  channel: ChannelId;
  connected: boolean;
  lastInbound?: string;
  lastOutbound?: string;
  errors?: string[];
  /** Optional bridge-specific metadata. */
  details?: Record<string, unknown>;
}

/**
 * High-level channel service used by the engine runtime.
 */
export interface IChannelService {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(channel: ChannelId, message: OutboundMessage): Promise<void>;
  handleInbound(channel: ChannelId, payload: InboundPayload): Promise<void>;
  getStatus(): ChannelStatus[];
}
