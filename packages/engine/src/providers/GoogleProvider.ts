import type { CompletionRequest, CompletionChunk, ModelInfo, ProviderId } from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';

const GOOGLE_MODELS: ModelInfo[] = [
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', providerId: 'google', contextWindow: 1000000, capabilities: ['text', 'function_calling', 'streaming'] },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', providerId: 'google', contextWindow: 1000000, capabilities: ['text', 'function_calling', 'streaming', 'reasoning'] },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', providerId: 'google', contextWindow: 1000000, capabilities: ['text', 'function_calling', 'streaming', 'reasoning'] },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', providerId: 'google', contextWindow: 1000000, capabilities: ['text', 'function_calling', 'streaming'] },
];

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
    return GOOGLE_MODELS;
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
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google API error (${response.status}): ${text}`);
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
