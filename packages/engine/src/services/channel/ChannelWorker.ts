import type { Logger } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { Agent } from '../../agent/Agent.js';
import type { ChannelId, IChannelService, OutboundMessage } from './IChannelService.js';
import type { InboundPayload } from './IChannelService.js';
import { InboundQueue } from './InboundQueue.js';

export interface ChannelWorkerOptions {
  inboundQueue: InboundQueue;
  ensureChannelAgent?: (channelId: ChannelId, senderId: string) => Agent | null | Promise<Agent | null>;
  channelService?: IChannelService;
  logger?: Logger;
}

/**
 * Processes inbound payloads from an {@link InboundQueue} by routing them
 * through a channel agent. For now the agent resolver is a mock so the
 * worker can be wired up to real agent creation in a follow-up phase.
 */
export class ChannelWorker {
  private readonly inboundQueue: InboundQueue;
  private ensureChannelAgent: (channelId: ChannelId, senderId: string) => Promise<Agent | null>;
  private readonly channelService?: IChannelService;
  private readonly logger: Logger;

  constructor(options: ChannelWorkerOptions) {
    this.inboundQueue = options.inboundQueue;
    this.ensureChannelAgent = (channelId, senderId) =>
      Promise.resolve(options.ensureChannelAgent?.(channelId, senderId) ?? this.defaultEnsureChannelAgent());
    this.channelService = options.channelService;
    this.logger = options.logger ?? getLogger('channel-worker');
  }

  start(): void {
    this.inboundQueue.onProcess = (payload) => this.process(payload);
  }

  stop(): void {
    this.inboundQueue.onProcess = undefined;
  }

  setAgentFactory(agentFactory: ChannelWorkerOptions['ensureChannelAgent']): void {
    this.ensureChannelAgent = (channelId, senderId) =>
      Promise.resolve(agentFactory?.(channelId, senderId) ?? this.defaultEnsureChannelAgent());
  }

  async process(payload: InboundPayload): Promise<void> {
    const agent = await this.ensureChannelAgent(payload.channel, payload.sender.id);
    if (!agent) {
      this.logger.warn('CHANNEL_AGENT_MISSING', 'No channel agent available', {
        channelId: payload.channel,
        senderId: payload.sender.id,
      });
      return;
    }
    const response = await agent.sendMessage(payload.text, {
      channelId: payload.channel,
      userId: payload.sender.id,
      sourceChannel: payload.channel,
    });
    if (this.channelService && response) {
      const message = this.buildResponseMessage(payload, response);
      if (message) {
        await this.channelService.send(payload.channel, message);
      }
    }
  }

  private buildResponseMessage(payload: InboundPayload, response: { content?: string | null; parts?: unknown }): OutboundMessage | undefined {
    const text = typeof response.content === 'string' ? response.content : response.content ? String(response.content) : '';
    if (!text) return undefined;
    const outbound: OutboundMessage = { text, threadId: payload.threadId, replyTo: payload.messageId };
    if (payload.channel === 'email') {
      outbound.to = payload.sender.id;
      outbound.subject = 'Re: message';
    }
    return outbound;
  }

  private async defaultEnsureChannelAgent(): Promise<Agent | null> {
    const mock = {
      sendMessage: async (content: string, _options?: unknown) => {
        this.logger.debug('CHANNEL_WORKER_MOCK_SEND', content);
        return undefined as unknown as import('@agentx/shared').Message;
      },
    };
    return mock as unknown as Agent;
  }
}
