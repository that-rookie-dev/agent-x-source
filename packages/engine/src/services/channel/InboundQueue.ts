import type { ICache } from '../../cache/ICache.js';
import { RedisCache } from '../../cache/RedisCache.js';
import type { InboundPayload } from './IChannelService.js';

export type ProcessCallback = (item: InboundPayload) => void | Promise<void>;

export interface InboundQueueOptions {
  cache?: ICache;
  key?: string;
}

/**
 * FIFO queue for inbound channel payloads.
 *
 * Uses the supplied cache (Redis-backed when `REDIS_URL` is set) for durability,
 * falling back to an in-memory array when no cache is configured.
 */
export class InboundQueue {
  private readonly cache?: ICache;
  private readonly key: string;
  private readonly items: InboundPayload[] = [];
  private readonly errors: string[] = [];
  private processing = false;

  onProcess?: ProcessCallback;

  constructor(options?: InboundQueueOptions) {
    this.cache = process.env.REDIS_URL ? (options?.cache ?? new RedisCache()) : undefined;
    this.key = options?.key ?? 'channel:inbound-queue';
  }

  async enqueue(item: InboundPayload): Promise<void> {
    this.items.push(item);
    await this.persist();
    void this.processLoop();
  }

  async dequeue(): Promise<InboundPayload | null> {
    const item = this.items.shift() ?? null;
    await this.persist();
    return item;
  }

  peek(): InboundPayload | null {
    return this.items[0] ?? null;
  }

  get size(): number {
    return this.items.length;
  }

  async flush(): Promise<InboundPayload[]> {
    const all = this.items.slice();
    this.items.length = 0;
    await this.persist();
    return all;
  }

  getRecentErrors(): string[] {
    return this.errors.slice();
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(this.key, this.items);
    } catch {
      // Best-effort persistence; queue continues in memory.
    }
  }

  private async processLoop(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.onProcess && this.items.length > 0) {
        const item = this.items.shift()!;
        await this.persist();
        try {
          await Promise.resolve(this.onProcess(item));
        } catch (err) {
          this.errors.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
