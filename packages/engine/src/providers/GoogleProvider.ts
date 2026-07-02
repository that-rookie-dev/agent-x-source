import type { CompletionRequest, CompletionChunk, CompletionToolCall, ModelInfo, ProviderId } from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';

export class GoogleProvider implements ProviderInterface {
  readonly id: ProviderId = 'google';
  readonly name = 'Google';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai';
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Use Google's native API which returns inputTokenLimit per model
    const nativeBase = 'https://generativelanguage.googleapis.com/v1beta';
    try {
      const response = await fetch(`${nativeBase}/models?key=${this.apiKey}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          models?: Array<{
            name: string;
            displayName?: string;
            inputTokenLimit?: number;
            supportedGenerationMethods?: string[];
          }>;
        };
        const models = (data.models ?? [])
          .filter((m) => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
          .map((m): ModelInfo => ({
            id: m.name,
            name: m.displayName ?? m.name.replace('models/', ''),
            providerId: 'google',
            contextWindow: m.inputTokenLimit ?? 1000000,
            capabilities: ['text', 'function_calling', 'streaming'],
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (models.length > 0) return models;
      }
    } catch { /* fall through to OpenAI-compat endpoint */ }

    // Fallback: OpenAI-compatible endpoint (no token limits)
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? [])
      .filter((m) => m.id.includes('gemini'))
      .map((m): ModelInfo => ({
        id: m.id,
        name: m.id,
        providerId: 'google',
        contextWindow: 1000000,
        capabilities: ['text', 'function_calling', 'streaming'],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    // Google's OpenAI-compatible endpoint supports tool calling
    // but requires thought_signature on assistant tool calls in follow-up turns.
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => {
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          // Add empty thought_signature to each tool call for Gemini compatibility
          const toolCalls = m.toolCalls.map((tc) => ({
            ...tc,
            thought_signature: tc.thought_signature ?? '',
          }));
          return { role: m.role, content: m.content || null, tool_calls: toolCalls };
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
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.signal ?? AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google API error (${response.status}): ${text}`);
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
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
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
            const toolCall = tc ? {
              index: (tc as { index?: number }).index,
              id: tc.id ?? undefined,
              type: tc.type === 'function' ? 'function' : undefined,
              function: tc.function ? {
                name: tc.function.name ?? '',
                arguments: tc.function.arguments ?? '',
              } : undefined,
            } as Partial<CompletionToolCall> & { index?: number } : undefined;
            yield {
              type: 'tool_call_delta',
              toolCall,
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
