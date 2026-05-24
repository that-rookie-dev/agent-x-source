import type {
  CompletionRequest,
  CompletionChunk,
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';

export class AnthropicProvider implements ProviderInterface {
  readonly id: ProviderId = 'anthropic';
  readonly name = 'Anthropic';

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://api.anthropic.com';
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return response.ok || response.status === 400; // 400 means auth worked
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data?: Array<{ id: string; display_name?: string }>;
    };
    return (data.data ?? [])
      .filter((m) => m.id.includes('claude'))
      .map((m): ModelInfo => ({
        id: m.id,
        name: m.display_name ?? m.id,
        providerId: 'anthropic',
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'function_calling', 'streaming'],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: nonSystemMessages.map((m) => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.content,
      })),
      stream: true,
    };

    if (systemMessage) {
      body['system'] = systemMessage.content;
    }
    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          try {
            const event = JSON.parse(data) as {
              type: string;
              delta?: { type?: string; text?: string; partial_json?: string };
              content_block?: { type?: string; id?: string; name?: string };
            };

            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta' && event.delta.text) {
                yield { type: 'text_delta', content: event.delta.text };
              } else if (event.delta?.type === 'thinking_delta' && event.delta.text) {
                yield { type: 'reasoning_delta', content: event.delta.text };
              } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                yield {
                  type: 'tool_call_delta',
                  toolCall: {
                    function: { name: '', arguments: event.delta.partial_json },
                  },
                };
              }
            } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              yield {
                type: 'tool_call_delta',
                toolCall: {
                  id: event.content_block.id,
                  type: 'function',
                  function: { name: event.content_block.name ?? '', arguments: '' },
                },
              };
            } else if (event.type === 'message_stop') {
              yield { type: 'done' };
              return;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }
}
