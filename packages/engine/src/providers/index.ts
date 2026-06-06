import type { ProviderId } from '@agentx/shared';
import type { ProviderInterface } from './ProviderInterface.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OllamaProvider } from './OllamaProvider.js';
import { GoogleProvider } from './GoogleProvider.js';
import { LMStudioProvider } from './LMStudioProvider.js';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';

function getDefaultBaseUrl(providerId: ProviderId): string {
  switch (providerId) {
    case 'moonshot': return 'https://api.moonshot.ai/v1';
    case 'deepseek': return 'https://api.deepseek.com';
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'mistral': return 'https://api.mistral.ai/v1';
    case 'together': return 'https://api.together.xyz/v1';
    case 'xai': return 'https://api.x.ai/v1';
    case 'fireworks': return 'https://api.fireworks.ai/inference/v1';
    case 'perplexity': return 'https://api.perplexity.ai';
    case 'cohere': return 'https://api.cohere.com/compatibility/v1';
    case 'commandcode': return 'https://api.commandcode.ai/provider/v1';
    default: return 'https://api.openai.com/v1';
  }
}

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
      case 'moonshot':
      case 'deepseek':
      case 'groq':
      case 'mistral':
      case 'together':
      case 'xai':
      case 'fireworks':
      case 'perplexity':
      case 'cohere':
      case 'commandcode':
        if (!apiKey) throw new Error(`${providerId} requires an API key`);
        return new OpenAICompatibleProvider(providerId, providerId, apiKey, baseUrl ?? getDefaultBaseUrl(providerId));
      case 'azure':
        if (!apiKey) throw new Error('Azure OpenAI requires an API key');
        if (!baseUrl) throw new Error('Azure OpenAI requires a base URL (resource endpoint)');
        return new OpenAICompatibleProvider('azure', 'Azure OpenAI', apiKey, baseUrl);
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
export { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
