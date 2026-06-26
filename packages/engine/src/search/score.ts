import type { DeepSearchContentType, DeepSearchScores } from '@agentx/shared';
import type { SerpHit } from './providers/index.js';
import type { PageExtract } from './extract.js';

const AUTHORITY_TIERS: Record<string, number> = {
  'wikipedia.org': 0.95,
  'reuters.com': 0.92,
  'bbc.com': 0.9,
  'bbc.co.uk': 0.9,
  'nytimes.com': 0.9,
  'theguardian.com': 0.88,
  'nature.com': 0.9,
  'nasa.gov': 0.92,
  'arxiv.org': 0.88,
  'github.com': 0.82,
  'stackoverflow.com': 0.8,
  'youtube.com': 0.78,
  'imdb.com': 0.8,
};

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2),
  );
}

function relevanceScore(query: string, hit: SerpHit, page: PageExtract | null): number {
  const q = tokenize(query);
  const blob = `${hit.title} ${hit.snippet} ${page?.title ?? ''} ${page?.description ?? ''} ${page?.excerpt ?? ''}`.toLowerCase();
  let hits = 0;
  for (const t of q) {
    if (blob.includes(t)) hits += 1;
  }
  return Math.min(1, hits / Math.max(q.size, 1));
}

function authorityScore(domain: string): number {
  for (const [key, score] of Object.entries(AUTHORITY_TIERS)) {
    if (domain === key || domain.endsWith(`.${key}`)) return score;
  }
  if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 0.85;
  return 0.45;
}

function freshnessScore(publishedAt?: string): number {
  if (!publishedAt) return 0.4;
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return 0.4;
  const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (days <= 2) return 1;
  if (days <= 14) return 0.85;
  if (days <= 90) return 0.65;
  if (days <= 365) return 0.45;
  return 0.25;
}

function extractQualityScore(page: PageExtract | null): number {
  if (!page) return 0.2;
  let score = 0.3;
  if (page.title) score += 0.2;
  if (page.description || page.excerpt) score += 0.25;
  if (page.imageUrl) score += 0.15;
  if (page.publishedAt) score += 0.1;
  return Math.min(1, score);
}

function typeFitScore(contentType: DeepSearchContentType, intent: string[]): number {
  if (intent.includes('general')) return 0.6;
  if (intent.includes('video') && contentType === 'video') return 1;
  if (intent.includes('article') && contentType === 'article') return 1;
  if (intent.includes('social') && (contentType === 'social_profile' || contentType === 'social_post')) return 1;
  if (intent.includes('movie') && contentType === 'movie') return 1;
  if (intent.includes('product') && contentType === 'product') return 1;
  if (contentType === 'generic') return 0.45;
  return 0.35;
}

export function scoreSearchResult(input: {
  query: string;
  hit: SerpHit;
  page: PageExtract | null;
  contentType: DeepSearchContentType;
  intent: string[];
}): DeepSearchScores {
  const relevance = relevanceScore(input.query, input.hit, input.page);
  const authority = authorityScore(input.hit.domain);
  const freshness = freshnessScore(input.page?.publishedAt);
  const extractQuality = extractQualityScore(input.page);
  const typeFit = typeFitScore(input.contentType, input.intent);
  const final = (
    relevance * 0.45
    + authority * 0.2
    + freshness * 0.15
    + extractQuality * 0.1
    + typeFit * 0.1
  );
  return {
    relevance: round(relevance),
    authority: round(authority),
    freshness: round(freshness),
    extractQuality: round(extractQuality),
    typeFit: round(typeFit),
    final: round(final),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function preScoreSerpHit(query: string, hit: SerpHit): number {
  return relevanceScore(query, hit, null) * 0.7 + authorityScore(hit.domain) * 0.3;
}
