import type { CompletionRequest, CompletionChunk, ModelInfo, ProviderId } from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';

export class LMStudioProvider implements ProviderInterface {
  readonly id: ProviderId = 'lmstudio';
  readonly name = 'LM Studio';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    const url = baseUrl ?? 'http://localhost:1234/v1';
    // Ensure the base URL ends with /v1 (LM Studio's OpenAI-compatible endpoint)
    this.baseUrl = url.replace(/\/+$/, '').endsWith('/v1') ? url.replace(/\/+$/, '') : `${url.replace(/\/+$/, '')}/v1`;
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.id,
        providerId: 'lmstudio' as const,
        contextWindow: 8192,
        capabilities: ['text', 'streaming'] as const,
      }));
    } catch {
      return [];
    }
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => {
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return { role: m.role, content: m.content || null, tool_calls: m.toolCalls };
        }
        if (m.role === 'tool') {
          return { role: m.role, content: m.content, tool_call_id: m.toolCallId };
        }
        return { role: m.role, content: m.content };
      }),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools;
    }
    if (request.maxTokens !== undefined) {
      body['max_tokens'] = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      body['temperature'] = request.temperature;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LM Studio error (${response.status}): ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          yield { type: 'done', usage };
          return;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (parsed.usage) {
            usage = {
              inputTokens: parsed.usage.prompt_tokens ?? 0,
              outputTokens: parsed.usage.completion_tokens ?? 0,
            };
          }
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: 'text_delta', content: delta.content };
          }
          if (delta?.tool_calls && delta.tool_calls.length > 0) {
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
          // Skip malformed chunks
        }
      }
    }

    yield { type: 'done', usage };
  }
}
