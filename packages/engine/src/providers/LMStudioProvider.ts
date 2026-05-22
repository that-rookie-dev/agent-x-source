import type { CompletionRequest, CompletionChunk, ModelInfo, ProviderId } from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';

export class LMStudioProvider implements ProviderInterface {
  readonly id: ProviderId = 'lmstudio';
  readonly name = 'LM Studio';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'http://localhost:1234/v1';
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
    const body = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LM Studio error (${response.status}): ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield { type: 'text_delta', content };
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }
}
