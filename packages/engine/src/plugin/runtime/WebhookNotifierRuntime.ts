import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface WebhookNotifierConfig {
  url: string;
  events: string[];
  secret?: string;
  retries: number;
  timeout: number;
}

/**
 * Webhook Notifier plugin runtime.
 * Sends HTTP POST notifications to configured webhook URLs
 * when specified agent events occur.
 */
export class WebhookNotifierRuntime {
  private config: WebhookNotifierConfig;
  private enabled = false;
  private pending: Array<Promise<void>> = [];

  constructor(config: Partial<WebhookNotifierConfig> = {}) {
    this.config = {
      url: config.url || '',
      events: config.events || ['message_received', 'error', 'tool_complete'],
      secret: config.secret,
      retries: config.retries || 3,
      timeout: config.timeout || 5000,
    };

    if (this.config.url) {
      this.enabled = true;
      logger.info('WEBHOOK', `Notifier configured for ${this.config.url}`);
    }
  }

  /**
   * Called for every engine event. Filters by config.events and sends webhook.
   */
  async notify(eventType: string, data: Record<string, unknown>): Promise<void> {
    if (!this.enabled || !this.config.url) return;
    if (this.config.events.length > 0 && !this.config.events.includes(eventType)) return;

    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    const promise = this.sendWithRetry(payload);
    this.pending.push(promise);

    // Clean up completed promises
    promise.finally(() => {
      this.pending = this.pending.filter((p) => p !== promise);
    });

    // Limit pending queue
    if (this.pending.length > 50) {
      this.pending.shift();
    }
  }

  private async sendWithRetry(payload: Record<string, unknown>): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.secret) {
      // Simple HMAC-like signature
      const hash = await this.simpleHash(this.config.secret + JSON.stringify(payload));
      headers['X-Webhook-Signature'] = hash;
    }

    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(this.config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) return;
        logger.warn('WEBHOOK', `Attempt ${attempt}: HTTP ${response.status}`);
      } catch (e) {
        logger.warn('WEBHOOK', `Attempt ${attempt} failed: ${e}`);
      }

      // Exponential backoff
      if (attempt < this.config.retries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 500));
      }
    }
  }

  private async simpleHash(input: string): Promise<string> {
    // Use subtle crypto if available, otherwise simple hash
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(input);
      const hash = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // Simple fallback
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  updateConfig(config: Partial<WebhookNotifierConfig>): void {
    Object.assign(this.config, config);
    if (!this.config.url) this.enabled = false;
  }

  getConfig(): WebhookNotifierConfig {
    return { ...this.config };
  }
}
