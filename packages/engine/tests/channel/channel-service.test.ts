import { describe, it, expect, vi } from 'vitest';
import { ChannelService } from '../../src/services/channel/ChannelService.js';
import type { IChannelBridge } from '../../src/services/channel/IChannelBridge.js';
import type { ChannelId, InboundPayload, OutboundMessage } from '../../src/services/channel/IChannelService.js';
import { createServiceContext } from '../../src/services/ServiceContext.js';
import { getLogger } from '@agentx/shared';
import { InMemoryQueue } from '../../src/queue/InMemoryQueue.js';

class FakeBridge implements IChannelBridge {
  started = false;
  stopped = false;
  lastOutbound?: OutboundMessage;
  onInbound?: (channel: ChannelId, payload: InboundPayload) => void | Promise<void>;
  connected = false;

  async start(onInbound: (channel: ChannelId, payload: InboundPayload) => void | Promise<void>): Promise<void> {
    this.started = true;
    this.onInbound = onInbound;
    this.connected = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connected = false;
  }

  async send(message: OutboundMessage): Promise<void> {
    this.lastOutbound = message;
  }

  getStatus() {
    return { channel: 'discord' as ChannelId, connected: this.connected };
  }
}

function makeContext() {
  return createServiceContext({
    config: { provider: { activeProvider: 'openai', activeModel: 'gpt-4o', providers: { openai: { configured: true, apiKey: 'test' } } } } as any,
    logger: getLogger('test'),
    pgPool: null,
    queue: new InMemoryQueue(),
  });
}

describe('ChannelService', () => {
  it('starts and stops registered bridges', async () => {
    const ctx = makeContext();
    const bridge = new FakeBridge();
    const service = new ChannelService(ctx, {});
    service.registerBridge('discord', bridge);

    await service.start();
    expect(bridge.started).toBe(true);
    expect(bridge.connected).toBe(true);

    await service.stop();
    expect(bridge.stopped).toBe(true);
    expect(bridge.connected).toBe(false);
  });

  it('routes outbound messages through the bridge', async () => {
    const ctx = makeContext();
    const bridge = new FakeBridge();
    const service = new ChannelService(ctx, {});
    service.registerBridge('discord', bridge);
    await service.start();

    await service.send('discord', { text: 'hello' });
    expect(bridge.lastOutbound).toEqual({ text: 'hello' });

    await service.stop();
  });

  it('reports status for registered bridges', async () => {
    const ctx = makeContext();
    const bridge = new FakeBridge();
    const service = new ChannelService(ctx, {});
    service.registerBridge('discord', bridge);
    await service.start();

    const status = service.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0]!.channel).toBe('discord');
    expect(status[0]!.connected).toBe(true);

    await service.stop();
  });

  it('enqueues inbound payloads and routes them to an agent', async () => {
    const ctx = makeContext();
    const bridge = new FakeBridge();
    const sendMessage = vi.fn().mockResolvedValue({ content: 'reply' });
    const service = new ChannelService(ctx, {
      agentFactory: () => ({ sendMessage } as any),
    });
    service.registerBridge('discord', bridge);
    await service.start();

    const payload: InboundPayload = {
      channel: 'discord',
      sender: { id: 'u1', name: 'User' },
      text: 'hi',
      threadId: 'discord',
      raw: {},
      timestamp: new Date().toISOString(),
    };

    await service.handleInbound('discord', payload);
    // Wait for the worker to process the queue.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sendMessage).toHaveBeenCalledWith('hi', expect.objectContaining({ channelId: 'discord', userId: 'u1' }));
    expect(bridge.lastOutbound).toEqual({ text: 'reply', threadId: 'discord', replyTo: undefined });

    await service.stop();
  });

  it('returns an error when sending to an unregistered channel', async () => {
    const ctx = makeContext();
    const service = new ChannelService(ctx, {});
    await service.start();
    await expect(service.send('slack', { text: 'hello' })).rejects.toThrow('Channel slack is not registered');
    await service.stop();
  });
});
