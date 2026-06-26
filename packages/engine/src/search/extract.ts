import type { DeepSearchContentType, DeepSearchExtracted } from '@agentx/shared';

function metaContent(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return undefined;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]!.trim()) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
        }
      } else if (parsed && typeof parsed === 'object') {
        out.push(parsed as Record<string, unknown>);
      }
    } catch { /* skip malformed */ }
  }
  return out;
}

function pickJsonLdRating(blocks: Record<string, unknown>[]): string | undefined {
  for (const block of blocks) {
    const ar = block.aggregateRating as { ratingValue?: string | number; bestRating?: string | number } | undefined;
    if (ar?.ratingValue != null) {
      const val = String(ar.ratingValue);
      const best = ar.bestRating != null ? String(ar.bestRating) : '10';
      return `${val}/${best}`;
    }
  }
  return undefined;
}

function pickJsonLdValue(blocks: Record<string, unknown>[], key: string): string | undefined {
  for (const block of blocks) {
    const val = block[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (val && typeof val === 'object' && 'name' in (val as object)) {
      const name = (val as { name?: string }).name;
      if (name) return name;
    }
  }
  return undefined;
}

function extractReadableExcerpt(html: string, maxLen = 600): string {
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  const chunk = articleMatch?.[0] ?? mainMatch?.[0] ?? html;
  const text = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export interface PageExtract {
  title: string;
  description: string;
  excerpt: string;
  imageUrl?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
  ogType?: string;
  videoId?: string;
  rating?: string;
  duration?: string;
}

export async function fetchAndExtractPage(url: string): Promise<PageExtract | null> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AgentX/1.0 (+https://agent-x.local; research bot)' },
    signal: AbortSignal.timeout(10000),
    redirect: 'follow',
  });
  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('html') && !contentType.includes('text')) return null;

  const html = await response.text();
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const jsonLd = extractJsonLd(html);

  const title = metaContent(html, 'og:title')
    ?? metaContent(html, 'twitter:title')
    ?? pickJsonLdValue(jsonLd, 'headline')
    ?? pickJsonLdValue(jsonLd, 'name')
    ?? (titleTag ? decodeHtmlEntities(stripHtml(titleTag)) : '');

  const description = metaContent(html, 'og:description')
    ?? metaContent(html, 'description')
    ?? metaContent(html, 'twitter:description')
    ?? pickJsonLdValue(jsonLd, 'description')
    ?? '';

  const imageUrl = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
  const siteName = metaContent(html, 'og:site_name') ?? pickJsonLdValue(jsonLd, 'publisher');
  const author = metaContent(html, 'author')
    ?? pickJsonLdValue(jsonLd, 'author')
    ?? undefined;
  const publishedAt = metaContent(html, 'article:published_time')
    ?? pickJsonLdValue(jsonLd, 'datePublished')
    ?? undefined;
  const ogType = metaContent(html, 'og:type');
  const rating = pickJsonLdRating(jsonLd);
  const duration = metaContent(html, 'video:duration') ?? pickJsonLdValue(jsonLd, 'duration');

  let videoId: string | undefined;
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/i);
  if (ytMatch) videoId = ytMatch[1];

  const excerpt = description || extractReadableExcerpt(html);

  return {
    title: title.trim(),
    description: description.trim(),
    excerpt: excerpt.trim(),
    imageUrl,
    siteName,
    author,
    publishedAt,
    ogType,
    videoId,
    rating,
    duration,
  };
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function pageExtractToDeepSearchExtracted(page: PageExtract): DeepSearchExtracted {
  return {
    title: page.title,
    description: page.description,
    excerpt: page.excerpt,
    imageUrl: page.imageUrl,
    siteName: page.siteName,
    author: page.author,
    publishedAt: page.publishedAt,
    videoId: page.videoId,
    rating: page.rating,
    duration: page.duration,
  };
}

export function inferTypeFromPage(url: string, page: PageExtract | null): DeepSearchContentType {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const path = (() => { try { return new URL(url).pathname; } catch { return ''; } })();

  if (/youtube\.com|youtu\.be|vimeo\.com/.test(host)) return 'video';
  if (/instagram\.com/.test(host)) return path.split('/').filter(Boolean).length <= 1 ? 'social_profile' : 'social_post';
  if (/facebook\.com|fb\.com|twitter\.com|x\.com|tiktok\.com/.test(host)) {
    return path.split('/').filter(Boolean).length <= 1 ? 'social_profile' : 'social_post';
  }
  if (/imdb\.com|themoviedb\.org|rottentomatoes\.com/.test(host)) return 'movie';
  if (/amazon\.|ebay\.|etsy\.com|shopify/.test(host)) return 'product';
  if (/eventbrite|ticketmaster|seatgeek/.test(host)) return 'event';
  if (/maps\.google|yelp\.com|tripadvisor/.test(host)) return 'place';
  if (/\.pdf$/i.test(path)) return 'document';

  const og = page?.ogType?.toLowerCase() ?? '';
  if (og.includes('video')) return 'video';
  if (og.includes('article')) return 'article';
  if (og.includes('product')) return 'product';
  if (og.includes('profile')) return 'social_profile';

  if (page?.videoId) return 'video';
  if (page?.publishedAt || page?.author) return 'article';
  return 'generic';
}
