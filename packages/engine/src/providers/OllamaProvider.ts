import { randomUUID } from 'node:crypto';
import type {
  CompletionRequest,
  CompletionChunk,
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';

export class OllamaProvider implements ProviderInterface {
  readonly id: ProviderId = 'ollama';
  readonly name = 'Ollama (Local)';

  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'http://localhost:11434';
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);

    if (!response.ok) {
      throw new Error(`Failed to fetch Ollama models: ${response.status}`);
    }

    const data = (await response.json()) as {
      models: Array<{ name: string; details?: { parameter_size?: string } }>;
    };

    return data.models.map((m): ModelInfo => ({
      id: m.name,
      name: m.name,
      providerId: 'ollama',
      contextWindow: 8192, // Default; varies by model
      capabilities: ['text', 'streaming', 'function_calling'],
    }));
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => {
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: m.role,
            content: m.content || '',
            tool_calls: m.toolCalls.map((tc) => ({
              function: { name: tc.function.name, arguments: JSON.parse(tc.function.arguments || '{}') },
            })),
          };
        }
        if (m.role === 'tool') {
          return { role: m.role, content: m.content };
        }
        return { role: m.role, content: m.content };
      }),
      stream: true,
    };

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
      }));
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
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
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as {
              message?: {
                content?: string;
                tool_calls?: Array<{
                  function?: { name?: string; arguments?: Record<string, unknown> };
                }>;
              };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            };
            // Ollama may return tool_calls and done in the same JSON line.
            // Yield tool calls BEFORE done so the agent sees them.
            if (parsed.message?.tool_calls && parsed.message.tool_calls.length > 0) {
              for (const tc of parsed.message.tool_calls) {
                if (tc.function) {
                  yield {
                    type: 'tool_call_delta',
                    toolCall: {
                      id: randomUUID(),
                      type: 'function',
                      function: {
                        name: tc.function.name ?? '',
                        arguments: JSON.stringify(tc.function.arguments ?? {}),
                      },
                    },
                  };
                }
              }
            }
            if (parsed.message?.content) {
              yield { type: 'text_delta', content: parsed.message.content };
            }
            if (parsed.done) {
              yield {
                type: 'done',
                usage: {
                  inputTokens: parsed.prompt_eval_count ?? 0,
                  outputTokens: parsed.eval_count ?? 0,
                },
              };
              return;
            }
          } catch {
            // Skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }
}
