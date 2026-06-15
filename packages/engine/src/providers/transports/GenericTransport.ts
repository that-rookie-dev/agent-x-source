import type {
  ProviderPlan,
  ProviderRoute,
  AgentXStreamEvent,
} from '@agentx/shared';
import { BaseTransport } from './BaseTransport.js';

export class GenericTransport extends BaseTransport {
  readonly id: string;
  readonly route: ProviderRoute;
  readonly state: Record<string, unknown> = {};

  constructor(route: ProviderRoute) {
    super();
    this.id = `${route.provider}-transport`;
    this.route = route;
  }

  canHandle(plan: ProviderPlan): boolean {
    return (
      plan.route === this.route.id ||
      plan.route === '' ||
      plan.route === 'openai-compatible'
    );
  }

  async *stream(
    plan: ProviderPlan,
    signal: AbortSignal,
  ): AsyncIterable<AgentXStreamEvent> {
    const url = this.buildUrl(plan);
    const headers = await this.getHeaders(plan);
    const body = JSON.stringify(this.buildRequestBody(plan));

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
      signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const bodySnippet = bodyText ? `: ${bodyText.slice(0, 300)}` : '';
      yield {
        type: 'provider.error',
        turnId: plan.requestId,
        code: `HTTP_${response.status}`,
        message: `Provider returned ${response.status}: ${response.statusText}${bodySnippet}`,
        rawBody: bodyText,
        ts: Date.now(),
      };
      return;
    }

    if (!response.body) {
      yield {
        type: 'provider.error',
        turnId: plan.requestId,
        code: 'NO_BODY',
        message: 'Response has no body',
        ts: Date.now(),
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (this.route.framing === 'json-lines') {
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const chunk = JSON.parse(trimmed);
              const event = this.route.protocol.normalizeEvent(chunk, this.state);
              if (event) yield event;
            } catch {
              // Skip unparseable chunks
            }
          }
        } else {
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const chunk = JSON.parse(data);
              const event = this.route.protocol.normalizeEvent(chunk, this.state);
              if (event) yield event;
            } catch {
              // Skip unparseable chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: 'turn.end',
      turnId: plan.requestId,
      stopReason: 'stream_end',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      ts: Date.now(),
    };
  }
}
