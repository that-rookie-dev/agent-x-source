import type {
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import { OpenAIProvider } from './OpenAIProvider.js';

/**
 * Generic OpenAI-compatible provider.
 * Covers any provider that uses the standard OpenAI API format
 * (/models, /chat/completions, streaming SSE).
 *
 * Handles multiple response formats across providers:
 *   - { data: [{ id, ... }] }  — OpenAI, Groq, DeepSeek, etc.
 *   - { models: [{ id, ... }] } — Together AI, etc.
 *   - Edge cases: empty arrays, missing keys, non-JSON responses
 */
export class OpenAICompatibleProvider extends OpenAIProvider {
  readonly id: ProviderId;
  readonly name: string;

  constructor(id: ProviderId, name: string, apiKey: string, baseUrl: string) {
    super(apiKey, baseUrl);
    this.id = id;
    this.name = name;
  }

  async listModels(): Promise<ModelInfo[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error(`Unable to reach ${this.name} API. Check your connection and base URL.`);
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`${this.name} does not support model listing via /models endpoint. Try configuring models manually.`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Invalid API key for ${this.name}. Check your credentials.`);
      }
      throw new Error(`${this.name} API error: ${response.status} ${response.statusText}`);
    }

    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error(`Unexpected response from ${this.name}. Expected JSON but got: ${await response.text().catch(() => 'unreadable')}`);
    }

    // Try standard OpenAI { data: [...] } format
    if (Array.isArray(json['data'])) {
      const items = json['data'] as Array<Record<string, unknown>>;
      return this.parseModels(items);
    }

    // Try { models: [...] } format (Together AI, etc.)
    if (Array.isArray(json['models'])) {
      const items = json['models'] as Array<Record<string, unknown>>;
      return this.parseModels(items);
    }

    // Try { results: [...] } format (Fireworks, etc.)
    if (Array.isArray(json['results'])) {
      const items = json['results'] as Array<Record<string, unknown>>;
      return this.parseModels(items);
    }

    // Known models fallback — provider API returned OK but format is unrecognised
    const knownModels = KNOWN_MODELS[this.id];
    if (knownModels && knownModels.length > 0) {
      return knownModels.map((m) => ({
        id: m,
        name: m,
        providerId: this.id,
        contextWindow: this.getContextWindow(m),
        capabilities: this.getCapabilities(m),
      })).sort((a, b) => a.name.localeCompare(b.name));
    }

    return [];
  }

  private parseModels(items: Array<Record<string, unknown>>): ModelInfo[] {
    return items
      .map((m): ModelInfo => {
        const id = String(m['id'] ?? m['name'] ?? '');
        return {
          id,
          name: String(m['display_name'] ?? m['name'] ?? m['id'] ?? id),
          providerId: this.id,
          contextWindow: this.getContextWindow(id),
          capabilities: this.getCapabilities(id),
        };
      })
      .filter((m) => m.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

// Known model IDs for providers whose API doesn't expose a /models endpoint.
// Kept lightweight — users can type in any model ID in the chat panel's model selector.
const KNOWN_MODELS: Partial<Record<ProviderId, string[]>> = {
  perplexity: [
    'sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning',
    'sonar-deep-research', 'codestral-latest',
  ],
  fireworks: [
    'accounts/fireworks/models/llama-v3p3-70b-instruct',
    'accounts/fireworks/models/llama-v3p1-8b-instruct',
    'accounts/fireworks/models/mixtral-8x22b-instruct',
    'accounts/fireworks/models/deepseek-r1',
    'accounts/fireworks/models/qwen2p5-72b-instruct',
  ],
  cohere: [
    'command-r-plus', 'command-r', 'command-r7b-12-2024',
    'c4ai-aya-23-35b',
  ],
};
