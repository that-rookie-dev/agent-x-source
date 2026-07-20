import type { ServiceContext } from '../ServiceContext.js';
import type { ChannelId, ChannelStatus, IChannelService, InboundPayload, OutboundMessage } from './IChannelService.js';
import type { IChannelBridge } from './IChannelBridge.js';
import type { Agent } from '../../agent/Agent.js';
import { getLogger } from '@agentx/shared';
import { ChannelRegistry } from './ChannelRegistry.js';
import { InboundQueue } from './InboundQueue.js';
import { ChannelWorker } from './ChannelWorker.js';
import { ChannelRateLimiter, type ChannelPolicyConfig } from './ChannelRateLimiter.js';

export interface ChannelServiceConfig {
  bridges?: Record<ChannelId, IChannelBridge>;
  agentFactory?: (channelId: ChannelId, senderId: string) => Agent | null | Promise<Agent | null>;
  perChannelPolicies?: Partial<Record<ChannelId, ChannelPolicyConfig>>;
}

const ALL_CHANNEL_IDS: ChannelId[] = ['telegram', 'discord', 'slack', 'email'];

function isChannelId(value: string): value is ChannelId {
  return ALL_CHANNEL_IDS.includes(value as ChannelId);
}

export class ChannelService implements IChannelService {
  private readonly ctx: ServiceContext;
  private readonly config: ChannelServiceConfig;
  public readonly registry = new ChannelRegistry();
  public readonly inboundQueue: InboundQueue;
  public readonly worker: ChannelWorker;
  public readonly rateLimiter: ChannelRateLimiter;
  private readonly channelMetrics = new Map<ChannelId, ChannelStatus>();
  private readonly startedBridges = new Set<ChannelId>();

  constructor(ctx: ServiceContext, config: ChannelServiceConfig = {}) {
    this.ctx = ctx;
    this.config = config;
    this.inboundQueue = new InboundQueue({ cache: ctx.cache, key: 'channel:inbound-queue' });
    this.worker = new ChannelWorker({
      inboundQueue: this.inboundQueue,
      ensureChannelAgent: config.agentFactory,
      channelService: this,
      logger: ctx.logger,
    });
    this.rateLimiter = new ChannelRateLimiter(config.perChannelPolicies);
    this.registerBridgesFromConfig();
  }

  registerBridge(channelId: ChannelId, bridge: IChannelBridge): void {
    this.registry.register(channelId, bridge);
    this.ensureMetrics(channelId);
  }

  setAgentFactory(agentFactory: ChannelServiceConfig['agentFactory']): void {
    this.worker.setAgentFactory(agentFactory);
  }

  async start(): Promise<void> {
    this.worker.start();
    for (const { channelId, bridge } of this.registry.list()) {
      if (this.startedBridges.has(channelId)) continue;
      this.ensureMetrics(channelId);
      try {
        await bridge.start(this.handleInbound.bind(this));
        this.startedBridges.add(channelId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.ctx.logger.error('CHANNEL_BRIDGE_START_FAILED', err, { channelId, msg });
        this.ensureMetrics(channelId).errors!.push(msg);
      }
    }
  }

  async stop(): Promise<void> {
    this.worker.stop();
    for (const { channelId, bridge } of this.registry.list()) {
      if (!this.startedBridges.has(channelId)) continue;
      try {
        await bridge.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.ctx.logger.error('CHANNEL_BRIDGE_STOP_FAILED', err, { channelId, msg });
        this.ensureMetrics(channelId).errors!.push(msg);
      }
      this.startedBridges.delete(channelId);
    }
    this.registry.clear();
  }

  async send(channel: ChannelId, message: OutboundMessage): Promise<void> {
    const bridge = this.registry.get(channel);
    if (!bridge) {
      throw new Error(`Channel ${channel} is not registered`);
    }
    let lastErr: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        await bridge.send(message);
        this.ensureMetrics(channel).lastOutbound = new Date().toISOString();
        return;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        this.ensureMetrics(channel).errors!.push(msg);
        if (!this.rateLimiter.canRetry(channel, attempt)) break;
        getLogger().warn('CHANNEL_SEND_RETRY', `Send failed on ${channel}, retrying (attempt ${attempt + 1})`, { channel, msg, attempt });
        await this.rateLimiter.backoff(channel, attempt);
      }
    }
    throw lastErr;
  }

  async handleInbound(channel: ChannelId, payload: InboundPayload): Promise<void> {
    this.ensureMetrics(channel).lastInbound = new Date().toISOString();
    await this.inboundQueue.enqueue({ ...payload, channel });
  }

  getStatus(): ChannelStatus[] {
    return this.registry.list().map(({ channelId, bridge }) => {
      const bridgeStatus = bridge.getStatus();
      const metrics = this.ensureMetrics(channelId);
      return {
        channel: channelId,
        connected: bridgeStatus.connected,
        lastInbound: metrics.lastInbound ?? bridgeStatus.lastInbound,
        lastOutbound: metrics.lastOutbound ?? bridgeStatus.lastOutbound,
        errors: [...(metrics.errors ?? []), ...(bridgeStatus.errors ?? [])].slice(0, 10),
        details: bridgeStatus.details,
      };
    });
  }

  private ensureMetrics(channelId: ChannelId): ChannelStatus {
    let status = this.channelMetrics.get(channelId);
    if (!status) {
      status = { channel: channelId, connected: false, errors: [] };
      this.channelMetrics.set(channelId, status);
    }
    return status;
  }

  private registerBridgesFromConfig(): void {
    const bridges = this.config.bridges;
    if (!bridges) return;
    for (const [key, bridge] of Object.entries(bridges) as [ChannelId, IChannelBridge | undefined][]) {
      if (!bridge) continue;
      if (!isChannelId(key)) {
        this.ctx.logger.warn('CHANNEL_CONFIG_UNKNOWN_KEY', `Ignoring unknown channel key in ChannelService config: ${key}`, { key });
        continue;
      }
      this.registerBridge(key, bridge);
    }
  }
}
