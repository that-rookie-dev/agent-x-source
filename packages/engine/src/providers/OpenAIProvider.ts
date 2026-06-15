import type {
  CompletionRequest,
  CompletionChunk,
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';
import { captureResponse } from '../utils/DebugLogger.js';

export class OpenAIProvider implements ProviderInterface {
  readonly id: ProviderId = 'openai';
  readonly name: string = 'OpenAI';

  protected apiKey: string;
  protected baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://api.openai.com/v1';
  }

  async validate(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      const response = await fetch(`${this.baseUrl}/models`, { headers });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    const response = await fetch(`${this.baseUrl}/models`, { headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      await captureResponse(this.id, `${this.baseUrl}/models`, `listModels-error-${response.status}`, response);
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    let json: { data?: Array<Record<string, unknown>> };
    try {
      json = (await response.json()) as { data?: Array<Record<string, unknown>> };
    } catch {
      const raw = await response.text().catch(() => 'unreadable');
      await captureResponse(this.id, `${this.baseUrl}/models`, 'listModels-non-json', response);
      throw new Error(`Unexpected response from OpenAI. Expected JSON but got: ${raw}`);
    }

    if (!Array.isArray(json.data)) {
      await captureResponse(this.id, `${this.baseUrl}/models`, 'listModels-no-data-array', response);
      throw new Error(`OpenAI API returned unexpected format: 'data' field is not an array`);
    }

    return json.data
      .filter((m: Record<string, unknown>) => {
        const id = String(m['id'] ?? '');
        return id.includes('gpt') || id.includes('o1') || id.includes('o3');
      })
      .map((m: Record<string, unknown>): ModelInfo => ({
        id: String(m['id'] ?? ''),
        name: String(m['id'] ?? ''),
        providerId: 'openai',
        contextWindow: this.getContextWindow(String(m['id'] ?? '')),
        capabilities: this.getCapabilities(String(m['id'] ?? '')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => {
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const msg: Record<string, unknown> = { role: m.role, content: m.content || null, tool_calls: m.toolCalls };
          if (m.reasoning) msg.reasoning_content = m.reasoning;
          return msg;
        }
        if (m.role === 'tool') {
          return { role: m.role, content: m.content, tool_call_id: m.toolCallId };
        }
        const msg: Record<string, unknown> = { role: m.role, content: m.reasoning && !m.content ? null : m.content };
        if (m.reasoning) msg.reasoning_content = m.reasoning;
        return msg;
      }),
      stream: true,
      stream_options: { include_usage: true },
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
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
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };

            if (parsed.usage) {
              usage = {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
              };
            }

            const choice = parsed.choices[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta.content) {
              yield { type: 'text_delta', content: delta.content };
            }
            if ((delta as Record<string, unknown>).reasoning_content) {
              yield { type: 'reasoning_delta', content: (delta as Record<string, unknown>).reasoning_content as string };
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

    yield { type: 'done', usage };
  }

  protected getContextWindow(modelId: string): number {
    if (modelId.includes('gpt-4o')) return 128000;
    if (modelId.includes('gpt-4-turbo')) return 128000;
    if (modelId.includes('gpt-4')) return 8192;
    if (modelId.includes('gpt-3.5')) return 16385;
    if (modelId.includes('o1') || modelId.includes('o3')) return 200000;
    return 128000;
  }

  protected getCapabilities(modelId: string): ModelInfo['capabilities'] {
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
