import { canonicalizeUrl, extractDomain } from '../url-utils.js';

export interface SerpHit {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  provider: string;
  rank: number;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const DDG_HTML_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: 'https://html.duckduckgo.com',
  Referer: 'https://html.duckduckgo.com/',
};

function decodeDdgRedirect(href: string): string {
  try {
    const absolute = href.startsWith('//') ? `https:${href}` : href;
    const u = new URL(absolute);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return absolute;
  } catch {
    return href;
  }
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function isBotChallenge(html: string): boolean {
  return html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo');
}

/** Parse DuckDuckGo HTML SERP (web-result blocks). */
export function parseDuckDuckGoHtml(html: string, limit = 10): SerpHit[] {
  if (!html || isBotChallenge(html)) return [];

  const hits: SerpHit[] = [];
  const seen = new Set<string>();

  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(html)) !== null && hits.length < limit) {
    const rawUrl = decodeDdgRedirect(linkMatch[1]!);
    const title = stripHtml(linkMatch[2]!);
    if (!title || !rawUrl.startsWith('http')) continue;

    const url = canonicalizeUrl(rawUrl);
    if (seen.has(url)) continue;
    seen.add(url);

    const tail = html.slice(linkMatch.index, linkMatch.index + 2500);
    const snippetMatch =
      tail.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      ?? tail.match(/<span[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]!) : '';

    hits.push({
      title,
      url,
      snippet,
      domain: extractDomain(rawUrl),
      provider: 'duckduckgo',
      rank: hits.length + 1,
    });
  }

  return hits;
}

async function fetchDuckDuckGoHtml(query: string): Promise<string> {
  const body = new URLSearchParams({ q: query, b: '', kl: 'wt-wt', df: '' }).toString();
  const response = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: DDG_HTML_HEADERS,
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return '';
  return response.text();
}

export async function searchDuckDuckGo(query: string, limit = 10): Promise<SerpHit[]> {
  try {
    const html = await fetchDuckDuckGoHtml(query);
    return parseDuckDuckGoHtml(html, limit);
  } catch {
    return [];
  }
}
