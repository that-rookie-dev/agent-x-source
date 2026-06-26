import type { SerpHit } from './duckduckgo.js';
import { searchDuckDuckGo } from './duckduckgo.js';
import { searchBrave } from './brave.js';
import { searchExa } from './exa.js';
import { searchTavily } from './tavily.js';
import { getWebSearchRuntime, listActiveWebSearchProviders } from '../search-config.js';

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

export async function runWebSearch(query: string, limit = 10): Promise<SerpHit[]> {
  const rt = getWebSearchRuntime();
  const tasks: Array<Promise<SerpHit[]>> = [];

  if (rt.duckduckgo) {
    tasks.push(searchDuckDuckGo(query, limit));
  }
  if (rt.brave) {
    tasks.push(searchBrave(query, rt.brave, limit));
  }
  if (rt.exa) {
    tasks.push(searchExa(query, rt.exa, limit));
  }
  if (rt.tavily) {
    tasks.push(searchTavily(query, rt.tavily, limit));
  }

  if (tasks.length === 0) return [];

  const batches = await Promise.all(tasks.map((t) => t.catch(() => [] as SerpHit[])));
  return mergeSerpHits(batches).slice(0, limit);
}

export function describeActiveWebSearchProviders(): string {
  const active = listActiveWebSearchProviders();
  if (active.length === 0) return 'none (configure web search in Settings → Tools)';
  return active.join(', ');
}

export type { SerpHit };
