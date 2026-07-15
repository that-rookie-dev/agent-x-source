import type { ChannelId } from './IChannelService.js';

export interface ChannelRetryConfig {
  /** Maximum retry attempts for failed outbound sends. */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;
}

export interface ChannelPolicyConfig {
  retry?: ChannelRetryConfig;
}

const DEFAULT_RETRY: ChannelRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

export class ChannelRateLimiter {
  private readonly configs = new Map<ChannelId, ChannelPolicyConfig>();

  constructor(policies?: Partial<Record<ChannelId, ChannelPolicyConfig>>) {
    if (policies) {
      for (const [channel, policy] of Object.entries(policies)) {
        if (policy) this.configs.set(channel as ChannelId, policy);
      }
    }
  }

  setPolicy(channel: ChannelId, policy: ChannelPolicyConfig): void {
    this.configs.set(channel, policy);
  }

  getPolicy(channel: ChannelId): ChannelPolicyConfig {
    return this.configs.get(channel) ?? { retry: DEFAULT_RETRY };
  }

  /** Sleep for the retry delay with exponential backoff and jitter. */
  async backoff(channel: ChannelId, attempt: number): Promise<void> {
    const policy = this.getPolicy(channel);
    const retry = policy.retry ?? DEFAULT_RETRY;
    if (attempt >= retry.maxRetries) return;
    const exp = Math.pow(2, attempt);
    const delay = Math.min(retry.baseDelayMs * exp, retry.maxDelayMs);
    const jitter = Math.random() * 0.3 * delay;
    await new Promise<void>((resolve) => setTimeout(resolve, delay + jitter));
  }

  /** Check if more retries are allowed. */
  canRetry(channel: ChannelId, attempt: number): boolean {
    const policy = this.getPolicy(channel);
    const retry = policy.retry ?? DEFAULT_RETRY;
    return attempt < retry.maxRetries;
  }
}
