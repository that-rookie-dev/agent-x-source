import type { WebSearchPaidProviderId } from '@agentx/shared';
import { searchBrave } from './providers/brave.js';
import { searchExa } from './providers/exa.js';
import { searchTavily } from './providers/tavily.js';

export interface WebSearchProviderValidation {
  ok: boolean;
  provider: WebSearchPaidProviderId;
  latencyMs?: number;
  error?: string;
}

export async function validateWebSearchProvider(
  provider: WebSearchPaidProviderId,
  apiKey: string,
): Promise<WebSearchProviderValidation> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, provider, error: 'API key is required' };
  }

  const started = Date.now();
  try {
    let hits: unknown[] = [];
    switch (provider) {
      case 'brave':
        hits = await searchBrave('agent-x connectivity test', key, 1);
        break;
      case 'exa':
        hits = await searchExa('agent-x connectivity test', key, 1);
        break;
      case 'tavily':
        hits = await searchTavily('agent-x connectivity test', key, 1);
        break;
    }
    const latencyMs = Date.now() - started;
    if (hits.length === 0) {
      return {
        ok: false,
        provider,
        latencyMs,
        error: 'API responded but returned no results — verify key permissions and quota',
      };
    }
    return { ok: true, provider, latencyMs };
  } catch (error) {
    return {
      ok: false,
      provider,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
