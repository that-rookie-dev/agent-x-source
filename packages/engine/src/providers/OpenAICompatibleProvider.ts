import type {
  ModelInfo,
  ProviderId,
} from '@agentx/shared';
import { apiRecordToModelInfo } from '@agentx/shared';
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

    return [];
  }

  protected parseModels(items: Array<Record<string, unknown>>): ModelInfo[] {
    return items
      .map((m) => apiRecordToModelInfo(m, this.id, this.getCapabilities(String(m['id'] ?? m['name'] ?? ''))))
      .filter((m): m is ModelInfo => m != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
