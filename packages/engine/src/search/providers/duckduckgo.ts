import { canonicalizeUrl, extractDomain } from '../url-utils.js';

export interface SerpHit {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  provider: string;
  rank: number;
}

const USER_AGENT = 'AgentX/1.0 (+https://agent-x.local; research bot)';

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

export async function searchDuckDuckGo(query: string, limit = 10): Promise<SerpHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return [];

  const html = await response.text();
  const hits: SerpHit[] = [];
  const blockRegex = /<div class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let blockMatch: RegExpExecArray | null;
  let rank = 0;

  while ((blockMatch = blockRegex.exec(html)) !== null && hits.length < limit) {
    const block = blockMatch[1]!;
    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const rawUrl = decodeDdgRedirect(linkMatch[1]!);
    const title = stripHtml(linkMatch[2]!);
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<span[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]!) : '';
    if (!title || !rawUrl.startsWith('http')) continue;
    rank += 1;
    hits.push({
      title,
      url: canonicalizeUrl(rawUrl),
      snippet,
      domain: extractDomain(rawUrl),
      provider: 'duckduckgo',
      rank,
    });
  }

  if (hits.length > 0) return hits;

  // Fallback parser for alternate DDG markup
  const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  rank = 0;
  while ((linkMatch = linkRegex.exec(html)) !== null && hits.length < limit) {
    const rawUrl = decodeDdgRedirect(linkMatch[1]!);
    const title = stripHtml(linkMatch[2]!);
    if (!title || !rawUrl.startsWith('http')) continue;
    rank += 1;
    hits.push({
      title,
      url: canonicalizeUrl(rawUrl),
      snippet: '',
      domain: extractDomain(rawUrl),
      provider: 'duckduckgo',
      rank,
    });
  }

  return hits;
}
