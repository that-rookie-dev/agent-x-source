import type {
  CompletionRequest,
  CompletionChunk,
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';

export class OpenAIProvider implements ProviderInterface {
  readonly id: ProviderId = 'openai';
  readonly name = 'OpenAI';

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://api.openai.com/v1';
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data: Array<{ id: string }> };
    return data.data
      .filter((m) => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3'))
      .map((m): ModelInfo => ({
        id: m.id,
        name: m.id,
        providerId: 'openai',
        contextWindow: this.getContextWindow(m.id),
        capabilities: this.getCapabilities(m.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
    };

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools;
    }
    if (request.temperature !== undefined) {
      body['temperature'] = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body['max_tokens'] = request.maxTokens;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
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
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{
                delta: {
                  content?: string;
                  tool_calls?: Array<{
                    id?: string;
                    type?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
            };
            const choice = parsed.choices[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta.content) {
              yield { type: 'text_delta', content: delta.content };
            }
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              const tc = delta.tool_calls[0];
              yield {
                type: 'tool_call_delta',
                toolCall: tc ? {
                  id: tc.id ?? undefined,
                  type: tc.type === 'function' ? 'function' : undefined,
                  function: tc.function ? {
                    name: tc.function.name ?? '',
                    arguments: tc.function.arguments ?? '',
                  } : undefined,
                } : undefined,
              };
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }

  private getContextWindow(modelId: string): number {
    if (modelId.includes('gpt-4o')) return 128000;
    if (modelId.includes('gpt-4-turbo')) return 128000;
    if (modelId.includes('gpt-4')) return 8192;
    if (modelId.includes('gpt-3.5')) return 16385;
    if (modelId.includes('o1') || modelId.includes('o3')) return 200000;
    return 128000;
  }

  private getCapabilities(modelId: string): ModelInfo['capabilities'] {
    const caps: ModelInfo['capabilities'] = ['text', 'streaming'];
    if (modelId.includes('gpt-4o') || modelId.includes('gpt-4-turbo')) {
      caps.push('vision', 'function_calling', 'json_mode');
    } else if (modelId.includes('gpt-4') || modelId.includes('gpt-3.5')) {
      caps.push('function_calling', 'json_mode');
    }
    if (modelId.includes('o1') || modelId.includes('o3')) {
      caps.push('reasoning', 'function_calling');
    }
    return caps;
  }
}
