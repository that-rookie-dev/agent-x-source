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

async function fetchDuckDuckGoHtmlGet(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://duckduckgo.com/',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return '';
  return response.text();
}

async function fetchDuckDuckGoLite(query: string): Promise<string> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return '';
  return response.text();
}

/** Parse DuckDuckGo Lite SERP rows. */
export function parseDuckDuckGoLite(html: string, limit = 10): SerpHit[] {
  if (!html || isBotChallenge(html)) return [];
  const hits: SerpHit[] = [];
  const seen = new Set<string>();
  const linkRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null && hits.length < limit) {
    const rawUrl = decodeDdgRedirect(match[1]!);
    const title = stripHtml(match[2]!);
    if (!title || !rawUrl.startsWith('http')) continue;
    const url = canonicalizeUrl(rawUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const tail = html.slice(match.index, match.index + 1800);
    const snippetMatch = tail.match(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
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

interface DdgApiTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgApiTopic[];
}

/** DuckDuckGo instant-answer API — useful when HTML SERP is empty (e.g. bot wall). */
export async function searchDuckDuckGoInstantApi(query: string, limit = 10): Promise<SerpHit[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&skip_disambig=1`;
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return [];
    const data = await response.json() as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: DdgApiTopic[];
    };
    const hits: SerpHit[] = [];
    const push = (title: string, rawUrl: string, snippet: string) => {
      if (!rawUrl.startsWith('http') || hits.length >= limit) return;
      const url = canonicalizeUrl(rawUrl);
      hits.push({
        title: title.slice(0, 200),
        url,
        snippet: snippet.slice(0, 400),
        domain: extractDomain(rawUrl),
        provider: 'duckduckgo',
        rank: hits.length + 1,
      });
    };
    if (data.AbstractURL && data.AbstractText) {
      push(data.Heading || query, data.AbstractURL, data.AbstractText);
    }
    const walk = (topics: DdgApiTopic[] | undefined) => {
      if (!topics) return;
      for (const t of topics) {
        if (t.Topics) walk(t.Topics);
        else if (t.FirstURL && t.Text) {
          const dash = t.Text.indexOf(' - ');
          const title = dash > 0 ? t.Text.slice(0, dash) : t.Text;
          const snippet = dash > 0 ? t.Text.slice(dash + 3) : '';
          push(title, t.FirstURL, snippet);
        }
      }
    };
    walk(data.RelatedTopics);
    return hits;
  } catch {
    return [];
  }
}

export async function searchDuckDuckGo(query: string, limit = 10): Promise<SerpHit[]> {
  try {
    let html = await fetchDuckDuckGoHtml(query);
    let hits = parseDuckDuckGoHtml(html, limit);
    if (hits.length === 0) {
      html = await fetchDuckDuckGoHtmlGet(query);
      hits = parseDuckDuckGoHtml(html, limit);
    }
    if (hits.length === 0) {
      const lite = await fetchDuckDuckGoLite(query);
      hits = parseDuckDuckGoLite(lite, limit);
    }
    if (hits.length === 0) {
      hits = await searchDuckDuckGoInstantApi(query, limit);
    }
    return hits;
  } catch {
    return [];
  }
}
