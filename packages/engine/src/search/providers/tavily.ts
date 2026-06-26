import { canonicalizeUrl, extractDomain } from '../url-utils.js';
import type { SerpHit } from './duckduckgo.js';

const USER_AGENT = 'AgentX/1.0 (+https://agent-x.local; research bot)';

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
}

export async function searchTavily(query: string, apiKey: string, limit = 10): Promise<SerpHit[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.min(limit, 20),
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return [];

  const data = await response.json() as { results?: TavilySearchResult[] };
  const rows = data.results ?? [];
  return rows.slice(0, limit).map((row, i) => {
    const rawUrl = row.url ?? '';
    return {
      title: row.title ?? rawUrl,
      url: canonicalizeUrl(rawUrl),
      snippet: row.content?.slice(0, 400) ?? '',
      domain: extractDomain(rawUrl),
      provider: 'tavily',
      rank: i + 1,
    };
  }).filter((h) => h.url.startsWith('http'));
}
