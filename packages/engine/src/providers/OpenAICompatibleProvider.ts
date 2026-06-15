import type {
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import { OpenAIProvider } from './OpenAIProvider.js';
import { captureResponse } from '../utils/DebugLogger.js';

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
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      response = await fetch(`${this.baseUrl}/models`, {
        headers,
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
      await captureResponse(this.id, `${this.baseUrl}/models`, `listModels-error-${response.status}`, response);
      throw new Error(`${this.name} API error: ${response.status} ${response.statusText}`);
    }

    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      const raw = await response.text().catch(() => 'unreadable');
      await captureResponse(this.id, `${this.baseUrl}/models`, 'listModels-non-json', response);
      throw new Error(`Unexpected response from ${this.name}. Expected JSON but got: ${raw}`);
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

    // Unrecognised format — log raw response for debugging
    await captureResponse(this.id, `${this.baseUrl}/models`, 'listModels-unrecognised-format', response);

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
  'opencode-zen': [
    'deepseek-v4-flash-free', 'big-pickle',
    'mimo-v2.5-free', 'north-mini-code-free', 'nemotron-3-ultra-free',
    'claude-haiku-4-5', 'claude-sonnet-4', 'claude-opus-4-5',
    'claude-opus-4-6', 'claude-opus-4-7',
    'gemini-3-flash', 'gemini-3.1-pro', 'gemini-3.5-flash',
    'gpt-5', 'gpt-5-codex', 'gpt-5-nano',
    'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini',
    'gpt-5.2', 'gpt-5.2-codex',
    'gpt-5.3-codex', 'gpt-5.3-codex-spark',
    'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
    'glm-5', 'glm-5.1', 'kimi-k2.5', 'kimi-k2.6',
    'deepseek-v4-pro', 'deepseek-v4-flash',
    'qwen-3.7-max', 'qwen-3.7-plus',
    'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
    'mimo-v2.5', 'mimo-v2.5-pro',
  ],
};
