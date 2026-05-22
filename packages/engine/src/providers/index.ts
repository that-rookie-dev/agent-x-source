import type { ProviderId } from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OllamaProvider } from './OllamaProvider.js';
import { GoogleProvider } from './GoogleProvider.js';
import { LMStudioProvider } from './LMStudioProvider.js';

export class ProviderFactory {
  static create(
    providerId: ProviderId,
    apiKey?: string,
    baseUrl?: string,
  ): ProviderInterface {
    switch (providerId) {
      case 'openai':
        if (!apiKey) throw new Error('OpenAI requires an API key');
        return new OpenAIProvider(apiKey, baseUrl);
      case 'anthropic':
        if (!apiKey) throw new Error('Anthropic requires an API key');
        return new AnthropicProvider(apiKey, baseUrl);
      case 'google':
        if (!apiKey) throw new Error('Google requires an API key');
        return new GoogleProvider(apiKey, baseUrl);
      case 'ollama':
        return new OllamaProvider(baseUrl);
      case 'lmstudio':
        return new LMStudioProvider(baseUrl);
      default:
        throw new Error(`Unknown provider: ${providerId}`);
    }
  }
}

export type { ProviderInterface } from './ProviderInterface.js';
export { OpenAIProvider } from './OpenAIProvider.js';
export { AnthropicProvider } from './AnthropicProvider.js';
export { OllamaProvider } from './OllamaProvider.js';
export { GoogleProvider } from './GoogleProvider.js';
export { LMStudioProvider } from './LMStudioProvider.js';
