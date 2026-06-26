import { canonicalizeUrl, extractDomain } from '../url-utils.js';
import type { SerpHit } from './duckduckgo.js';

const USER_AGENT = 'AgentX/1.0 (+https://agent-x.local; research bot)';

interface ExaSearchResult {
  title?: string;
  url?: string;
  text?: string;
  publishedDate?: string;
}

export async function searchExa(query: string, apiKey: string, limit = 10): Promise<SerpHit[]> {
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: Math.min(limit, 20),
      type: 'auto',
      contents: { text: { maxCharacters: 400 } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return [];

  const data = await response.json() as { results?: ExaSearchResult[] };
  const rows = data.results ?? [];
  return rows.slice(0, limit).map((row, i) => {
    const rawUrl = row.url ?? '';
    return {
      title: row.title ?? rawUrl,
      url: canonicalizeUrl(rawUrl),
      snippet: row.text?.slice(0, 400) ?? '',
      domain: extractDomain(rawUrl),
      provider: 'exa',
      rank: i + 1,
    };
  }).filter((h) => h.url.startsWith('http'));
}
