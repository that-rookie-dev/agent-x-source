import type { ChannelId, InboundPayload, OutboundMessage, ChannelStatus } from './IChannelService.js';

/**
 * Callback a bridge invokes when it receives an inbound message.
 */
export type OnInboundCallback = (channel: ChannelId, payload: InboundPayload) => void | Promise<void>;

/**
 * Bridge adapter for a single messaging channel.
 *
 * Implementations wrap concrete transports (Discord, Slack, email, Telegram, etc.)
 * behind a normalized contract used by {@link ChannelService}.
 */
export interface IChannelBridge {
  start(onInbound: OnInboundCallback): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  getStatus(): ChannelStatus;
}
