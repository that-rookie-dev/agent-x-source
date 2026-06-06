import type { ModelPricing } from '@agentx/shared';

/**
 * Pricing per million tokens for common models.
 * Based on published API pricing as of March 2026.
 */
const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4o-audio': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4.1': { inputPerMillion: 2.00, outputPerMillion: 8.00 },
  'gpt-4.1-mini': { inputPerMillion: 0.40, outputPerMillion: 1.60 },
  'gpt-4.1-nano': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gpt-4.5': { inputPerMillion: 75.00, outputPerMillion: 150.00 },
  'o1': { inputPerMillion: 15.00, outputPerMillion: 60.00 },
  'o3-mini': { inputPerMillion: 1.10, outputPerMillion: 4.40 },
  'o4-mini': { inputPerMillion: 1.10, outputPerMillion: 4.40 },

  // Anthropic
  'claude-sonnet-4': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-haiku-3.5': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  'claude-opus-4': { inputPerMillion: 15.00, outputPerMillion: 75.00 },

  // Google
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.00 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.60 },

  // Meta (via Together/OpenRouter)
  'llama-4-scout': { inputPerMillion: 0.30, outputPerMillion: 0.30 },
  'llama-4-maverick': { inputPerMillion: 0.60, outputPerMillion: 0.60 },
  'llama-3.3-70b': { inputPerMillion: 0.59, outputPerMillion: 0.79 },

  // DeepSeek
  'deepseek-v3': { inputPerMillion: 0.27, outputPerMillion: 1.10 },
  'deepseek-r1': { inputPerMillion: 0.55, outputPerMillion: 2.19 },

  // Mistral
  'mistral-large': { inputPerMillion: 2.00, outputPerMillion: 6.00 },
  'mistral-small': { inputPerMillion: 0.20, outputPerMillion: 0.60 },

  // Cohere
  'command-r7b': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'command-r': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'command-r-plus': { inputPerMillion: 2.50, outputPerMillion: 10.00 },

  // Moonshot
  'moonshot-v1-8k': { inputPerMillion: 0.50, outputPerMillion: 0.50 },
  'moonshot-v1-32k': { inputPerMillion: 1.00, outputPerMillion: 1.00 },
  'moonshot-v1-128k': { inputPerMillion: 3.00, outputPerMillion: 3.00 },

  // DeepSeek
  'deepseek-chat': { inputPerMillion: 0.27, outputPerMillion: 1.10 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },

  // Groq
  'llama-3.1-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  'mixtral-8x7b-32768': { inputPerMillion: 0.24, outputPerMillion: 0.24 },
  'gemma-7b-it': { inputPerMillion: 0.07, outputPerMillion: 0.07 },

  // Mistral
  'mistral-large-latest': { inputPerMillion: 2.00, outputPerMillion: 6.00 },
  'mistral-small-latest': { inputPerMillion: 0.20, outputPerMillion: 0.60 },
  'codestral-latest': { inputPerMillion: 0.20, outputPerMillion: 0.60 },

  // Together AI
  'llama-3.1-70b-instruct-turbo': { inputPerMillion: 0.88, outputPerMillion: 0.88 },
  'llama-3.1-8b-instruct-turbo': { inputPerMillion: 0.18, outputPerMillion: 0.18 },
  'qwen2.5-72b-instruct-turbo': { inputPerMillion: 1.20, outputPerMillion: 1.20 },

  // xAI (Grok)
  'grok-3': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'grok-3-mini': { inputPerMillion: 0.30, outputPerMillion: 0.50 },
  'grok-2': { inputPerMillion: 2.00, outputPerMillion: 10.00 },
  'grok-2-mini': { inputPerMillion: 0.20, outputPerMillion: 0.40 },
  'grok-beta': { inputPerMillion: 5.00, outputPerMillion: 15.00 },

  // Fireworks AI
  'accounts/fireworks/models/llama-v3p1-70b-instruct': { inputPerMillion: 0.90, outputPerMillion: 0.90 },
  'accounts/fireworks/models/llama-v3p1-8b-instruct': { inputPerMillion: 0.20, outputPerMillion: 0.20 },
  'accounts/fireworks/models/qwen2p5-72b-instruct': { inputPerMillion: 0.90, outputPerMillion: 0.90 },

  // Perplexity
  'sonar': { inputPerMillion: 1.00, outputPerMillion: 1.00 },
  'sonar-pro': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'sonar-reasoning': { inputPerMillion: 2.00, outputPerMillion: 8.00 },

  // Azure OpenAI (same as OpenAI — uses OpenAI model IDs, already priced above)

  // OpenRouter (dynamic — default estimate)
  'openrouter': { inputPerMillion: 2.00, outputPerMillion: 8.00 },

  // Ollama (local — free)
  'ollama': { inputPerMillion: 0, outputPerMillion: 0 },

  // CommandCode (Provider API — per-token pricing from commandcode.ai/docs/resources/pricing-limits)
  'gpt-5.5': { inputPerMillion: 5.00, outputPerMillion: 30.00 },
  'gpt-5.4': { inputPerMillion: 2.50, outputPerMillion: 15.00 },
  'gpt-5.4-mini': { inputPerMillion: 0.75, outputPerMillion: 4.50 },
  'kimi-k2.6': { inputPerMillion: 0.95, outputPerMillion: 4.00 },
  'kimi-k2.5': { inputPerMillion: 0.60, outputPerMillion: 3.00 },
  'glm-5.1': { inputPerMillion: 1.40, outputPerMillion: 4.40 },
  'glm-5': { inputPerMillion: 1.00, outputPerMillion: 3.20 },
  'minimax-m3': { inputPerMillion: 0.60, outputPerMillion: 2.40 },
  'minimax-m2.7': { inputPerMillion: 0.30, outputPerMillion: 1.20 },
  'minimax-m2.5': { inputPerMillion: 0.30, outputPerMillion: 1.20 },
  'deepseek-v4-pro': { inputPerMillion: 1.74, outputPerMillion: 3.48 },
  'deepseek-v4-flash': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'qwen-3.7-max': { inputPerMillion: 2.50, outputPerMillion: 7.50 },
  'qwen-3.7-plus': { inputPerMillion: 0.40, outputPerMillion: 1.60 },
  'mimo-v2.5-pro': { inputPerMillion: 2.00, outputPerMillion: 6.00 },
  'mimo-v2.5': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  'nemotron-3-ultra': { inputPerMillion: 0.50, outputPerMillion: 2.50 },
};

export function getModelPricing(modelId: string): ModelPricing {
  // Direct match
  if (PRICING[modelId]) return { ...PRICING[modelId] };

  // Partial match
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (lower.includes(key)) return { ...pricing };
  }

  // Default fallback
  return { inputPerMillion: 1.00, outputPerMillion: 4.00 };
}
