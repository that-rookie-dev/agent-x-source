import type { CompletionRequest, CompletionChunk, CompletionToolCall, ModelInfo, ProviderId } from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';
import {
  GEMINI_OPENAI_BASE,
  listGeminiModels,
  normalizeGoogleModelId,
} from './google/gemini-metadata.js';

export { normalizeGoogleModelId, listGeminiModels, fetchNativeGeminiModel } from './google/gemini-metadata.js';

function extractReasoningContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
  }
  return undefined;
}

export class GoogleProvider implements ProviderInterface {
  readonly id: ProviderId = 'google';
  readonly name = 'Google';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? GEMINI_OPENAI_BASE;
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
    return listGeminiModels(this.apiKey, this.baseUrl);
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const modelId = normalizeGoogleModelId(request.model);
    const body: Record<string, unknown> = {
      model: modelId,
      messages: request.messages.map((m) => {
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
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

    if (request.reasoningEffort) {
      body['reasoning_effort'] = request.reasoningEffort;
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
            yield { type: 'done', usage };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  reasoning_content?: unknown;
                  tool_calls?: Array<{
                    id?: string;
                    type?: string;
                    index?: number;
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
            if (!delta) continue;

            if (delta.content) {
              yield { type: 'text_delta', content: delta.content };
            }
            const reasoning = extractReasoningContent(delta.reasoning_content);
            if (reasoning) {
              yield { type: 'reasoning_delta', content: reasoning };
            }
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              const tc = delta.tool_calls[0];
              const toolCall = tc ? {
                index: tc.index,
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
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done', usage };
  }
}
