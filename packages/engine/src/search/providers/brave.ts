import { canonicalizeUrl, extractDomain } from '../url-utils.js';
import type { SerpHit } from './duckduckgo.js';

const USER_AGENT = 'AgentX/1.0 (+https://agent-x.local; research bot)';

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

export async function searchBrave(query: string, apiKey: string, limit = 10): Promise<SerpHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return [];

  const data = await response.json() as { web?: { results?: BraveWebResult[] } };
  const rows = data.web?.results ?? [];
  return rows.slice(0, limit).map((row, i) => {
    const rawUrl = row.url ?? '';
    return {
      title: row.title ?? rawUrl,
      url: canonicalizeUrl(rawUrl),
      snippet: row.description ?? '',
      domain: extractDomain(rawUrl),
      provider: 'brave',
      rank: i + 1,
    };
  }).filter((h) => h.url.startsWith('http'));
}

export type { SerpHit };
