import type {
  ProviderPlan,
  ProviderRoute,
  AgentXStreamEvent,
} from '@agentx/shared';
import { BaseTransport } from './BaseTransport.js';

export class AnthropicTransport extends BaseTransport {
  readonly id: string;
  readonly route: ProviderRoute;

  constructor(route: ProviderRoute) {
    super();
    this.id = `${route.provider}-transport`;
    this.route = route;
  }

  async *stream(
    plan: ProviderPlan,
    signal: AbortSignal,
  ): AsyncIterable<AgentXStreamEvent> {
    const url = this.buildUrl(plan);
    const headers = await this.getHeaders(plan);
    const body = JSON.stringify(this.buildAnthropicBody(plan));

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
      signal,
    });

    if (!response.ok) {
      yield {
        type: 'provider.error',
        turnId: plan.requestId,
        code: `HTTP_${response.status}`,
        message: `Provider returned ${response.status}: ${response.statusText}`,
        rawBody: await response.text().catch(() => ''),
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
        if (done) {
          // Emit turn.end on natural stream termination if not already emitted
          yield {
            type: 'turn.end',
            turnId: plan.requestId,
            stopReason: 'stream_end',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            ts: Date.now(),
          };
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data) as { type: string };
            const event = this.route.protocol.normalizeEvent(parsed, {});

            if (!event && parsed.type === 'message_stop') {
              yield {
                type: 'turn.end',
                turnId: plan.requestId,
                stopReason: 'end_turn',
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                ts: Date.now(),
              };
              continue;
            }

            if (event) yield event;
          } catch {
            // Skip unparseable chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private buildAnthropicBody(plan: ProviderPlan): unknown {
    const converted = this.route.protocol.convertMessages(
      plan.messages,
    ) as {
      system: string;
      messages: unknown[];
    };

    return {
      model: plan.modelId,
      system: converted.system,
      messages: converted.messages,
      tools: plan.tools.length > 0 ? this.route.protocol.convertTools(plan.tools) : undefined,
      max_tokens: plan.generation.maxOutputTokens ?? 4096,
      stream: true,
    };
  }
}
