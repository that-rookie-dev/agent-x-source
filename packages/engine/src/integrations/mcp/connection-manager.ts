import { getLogger } from '@agentx/shared';
import type { IntegrationHub } from '../integration-hub.js';

export class IntegrationConnectionManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly hub: IntegrationHub,
    private intervalMs = 5 * 60 * 1000,
  ) {}

  setIntervalMs(intervalMs: number): void {
    this.intervalMs = intervalMs;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.hub.maintainConnections();
    } catch (error) {
      getLogger().warn('INTEGRATION_HEALTH_POLL_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
    }
  }
}
