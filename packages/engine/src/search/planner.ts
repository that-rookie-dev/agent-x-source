import type { DeepSearchDepth, DeepSearchPlan } from '@agentx/shared';

const STOP = new Set([
  'the', 'and', 'for', 'with', 'what', 'when', 'where', 'how', 'why', 'who',
  'can', 'you', 'are', 'was', 'were', 'about', 'from', 'into', 'that', 'this',
]);

export function planSearchQueries(query: string, depth: DeepSearchDepth): DeepSearchPlan {
  const trimmed = query.trim();
  const tokens = trimmed.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const subQueries = new Set<string>([trimmed]);

  if (depth !== 'quick') {
    if (!/\b(latest|recent|new|202\d)\b/i.test(trimmed)) {
      subQueries.add(`${trimmed} latest`);
    }
    if (tokens.length >= 2) {
      subQueries.add(tokens.slice(0, 4).join(' '));
    }
  }

  if (depth === 'deep') {
    subQueries.add(`${trimmed} explained`);
    if (/\b(news|article|blog)\b/i.test(trimmed) === false) {
      subQueries.add(`${trimmed} news`);
    }
  }

  const intent: string[] = [];
  if (/\b(video|youtube|watch|trailer)\b/i.test(trimmed)) intent.push('video');
  if (/\b(news|headline|breaking)\b/i.test(trimmed)) intent.push('article');
  if (/\b(instagram|facebook|twitter|x\.com|tiktok|social)\b/i.test(trimmed)) intent.push('social');
  if (/\b(movie|film|imdb|ticket|showtime)\b/i.test(trimmed)) intent.push('movie');
  if (/\b(price|buy|shop|product|amazon)\b/i.test(trimmed)) intent.push('product');
  if (intent.length === 0) intent.push('general');

  return {
    subQueries: [...subQueries].slice(0, depth === 'quick' ? 1 : depth === 'standard' ? 3 : 4),
    intent,
  };
}

export function depthBudget(depth: DeepSearchDepth): { serpPerQuery: number; fetchCount: number; maxResults: number } {
  if (depth === 'quick') return { serpPerQuery: 6, fetchCount: 4, maxResults: 4 };
  if (depth === 'deep') return { serpPerQuery: 10, fetchCount: 12, maxResults: 8 };
  return { serpPerQuery: 8, fetchCount: 8, maxResults: 6 };
}
