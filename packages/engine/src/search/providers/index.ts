import type { SerpHit } from './duckduckgo.js';
import { searchDuckDuckGo } from './duckduckgo.js';
import { searchBrave } from './brave.js';
import { searchExa } from './exa.js';
import { searchTavily } from './tavily.js';
import {
  getWebSearchRuntime,
  listActiveWebSearchProviders,
  type ResolvedWebSearchProvider,
} from '../search-config.js';

function mergeSerpHits(batches: SerpHit[][]): SerpHit[] {
  const seen = new Set<string>();
  const out: SerpHit[] = [];
  for (const batch of batches) {
    for (const hit of batch) {
      const key = hit.url.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
  }
  return out;
}

async function searchOneProvider(
  provider: ResolvedWebSearchProvider,
  query: string,
  limit: number,
): Promise<SerpHit[]> {
  const rt = getWebSearchRuntime();
  switch (provider) {
    case 'duckduckgo':
      return searchDuckDuckGo(query, limit);
    case 'brave':
      return rt.brave ? searchBrave(query, rt.brave, limit) : [];
    case 'exa':
      return rt.exa ? searchExa(query, rt.exa, limit) : [];
    case 'tavily':
      return rt.tavily ? searchTavily(query, rt.tavily, limit) : [];
    default:
      return [];
  }
}

/** Minimum hits before we stop cascading to the next provider. */
function enoughHits(limit: number): number {
  return Math.min(limit, Math.max(3, Math.ceil(limit * 0.3)));
}

/**
 * Search using configured providers in priority order.
 * Tries each active provider until enough results accumulate (or the list ends).
 */
export async function runWebSearch(query: string, limit = 10): Promise<SerpHit[]> {
  const providers = listActiveWebSearchProviders();
  if (providers.length === 0) return [];

  const threshold = enoughHits(limit);
  let accumulated: SerpHit[] = [];

  for (const provider of providers) {
    const hits = await searchOneProvider(provider, query, limit).catch(() => [] as SerpHit[]);
    if (hits.length === 0) continue;
    accumulated = mergeSerpHits([accumulated, hits]);
    if (accumulated.length >= threshold) break;
  }

  return accumulated.slice(0, limit);
}

export function describeActiveWebSearchProviders(): string {
  const active = listActiveWebSearchProviders();
  if (active.length === 0) return 'none (configure web search in Settings → Tools)';
  return active.join(', ');
}

export type { SerpHit };
