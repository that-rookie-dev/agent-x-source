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
      capabilities: ['text', 'streaming'],
    }));
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const body = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
              message?: { content?: string };
              done?: boolean;
            };
            if (parsed.done) {
              yield { type: 'done' };
              return;
            }
            if (parsed.message?.content) {
              yield { type: 'text_delta', content: parsed.message.content };
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
