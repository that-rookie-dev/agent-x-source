import type { ProviderConfig } from '../types/provider.js';

export const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud',
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'cloud',
    apiKeyRequired: true,
    baseUrlConfigurable: false,
    defaultBaseUrl: 'https://api.anthropic.com',
  },
  google: {
    id: 'google',
    name: 'Google (Gemini)',
    type: 'cloud',
    apiKeyRequired: true,
    baseUrlConfigurable: false,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    type: 'local',
    apiKeyRequired: false,
    baseUrlConfigurable: true,
    defaultBaseUrl: 'http://localhost:11434',
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    type: 'local',
    apiKeyRequired: false,
    baseUrlConfigurable: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
  },
} as const;

export const PROVIDER_IDS = Object.keys(PROVIDERS) as string[];
