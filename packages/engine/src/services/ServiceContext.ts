import type { Pool } from 'pg';
import type { AgentXConfig, Logger } from '@agentx/shared';
import type { EventBus } from '../events/EventBus.js';
import type { ICache } from '../cache/ICache.js';
import { RedisCache } from '../cache/RedisCache.js';
import { LocalCache } from '../cache/LocalCache.js';
import { createEventBus } from '../events/EventBus.js';
import type { IJobQueue } from '../queue/IJobQueue.js';
import type { IChannelService } from './channel/IChannelService.js';
import { ChannelService } from './channel/ChannelService.js';
import { resolveChannelInboundAgent } from '../channels/channel-inbound-router.js';

/**
 * Shared context passed to every service on startup.
 *
 * This keeps service implementations decoupled from global singletons and
 * makes the runtime testable and containerizable.
 */
export interface ServiceContext {
  /** Resolved Agent-X configuration. */
  config: AgentXConfig;

  /** Structured logger. */
  logger: Logger;

  /** PostgreSQL connection pool. May be null when storage is deferred. */
  pgPool: Pool | null;

  /** Cache implementation (LocalCache or RedisCache). */
  cache: ICache;

  /** Job queue implementation. */
  queue: IJobQueue;

  /** Event bus for runtime events. */
  eventBus: EventBus;

  /** Channel service for routing inbound/outbound channel messages. */
  channelService?: IChannelService;
}

/**
 * Build a ServiceContext, wiring in RedisCache when REDIS_URL is set and
 * falling back to LocalCache otherwise.
 */
export function createServiceContext(
  partial: Omit<ServiceContext, 'cache' | 'channelService' | 'eventBus'> & { cache?: ICache; channelService?: IChannelService; eventBus?: EventBus },
): ServiceContext {
  const cache = partial.cache ?? (process.env['REDIS_URL'] ? new RedisCache() : new LocalCache());
  const ctx: ServiceContext = {
    config: partial.config,
    logger: partial.logger,
    pgPool: partial.pgPool,
    cache,
    queue: partial.queue,
    eventBus: partial.eventBus ?? createEventBus(),
  };
  ctx.channelService = partial.channelService ?? new ChannelService(ctx, {
    agentFactory: (channelId) => resolveChannelInboundAgent(channelId, null),
  });
  return ctx;
}
