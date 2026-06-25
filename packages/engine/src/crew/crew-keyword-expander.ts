import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { shouldSkipAutonomousCrewRouting, extractSubstantiveSearchTokens } from '../agent/crew-auto-compose.js';

const EXPERTISE_OPINION_PATTERNS = [
  /\b(need to know|want to know|learn about|tell me about|explain|understand|curious about)\b/i,
  /\b(what is|what are|how does|how do|why does|why do)\b/i,
  /\b(opinion|perspective|insights? on|expertise on)\b/i,
  /\b(who can help|who should i ask|who knows)\b.{0,48}\b(about|with|on)\b/i,
  /\b(specialist|expert|advisor|consultant)\b.{0,32}\b(for|on|in|about)\b/i,
] as const;

const EXPANDER_PROMPT = `You map user questions to specialist job-domain search keywords for a crew catalog.
Given the user message, return 3-6 short English keywords (job titles, fields, disciplines) that would match relevant specialists.
Focus on the SUBJECT DOMAIN, not filler words like "know", "help", or "about".
Reply with ONLY a JSON array of strings, no markdown. Example: ["astrophysics","astronomy","theoretical physics"]`;

export type CrewKeywordExpandFn = (message: string) => Promise<string[]>;

/** True when an LLM pass may help — expertise questions with a discernible subject. */
export function isExpertiseOpinionQuery(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || shouldSkipAutonomousCrewRouting(trimmed)) return false;
  if (!EXPERTISE_OPINION_PATTERNS.some((p) => p.test(trimmed))) return false;
  return extractSubstantiveSearchTokens(trimmed).length > 0;
}

export function parseExpandedKeywords(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === 'string')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length >= 3)
          .slice(0, 8);
      }
    } catch { /* fall through */ }
  }

  return trimmed
    .split(/[,;\n]+/)
    .map((s) => s.replace(/^[\s"'`-]+|[\s"'`-]+$/g, '').toLowerCase())
    .filter((s) => s.length >= 3 && !/^(json|array|keywords?)$/i.test(s))
    .slice(0, 8);
}

async function runLightweightCompletion(
  provider: ProviderInterface,
  model: string,
  userContent: string,
  maxTokens = 120,
): Promise<string> {
  let content = '';
  const completion = provider.complete({
    model,
    messages: [
      { role: 'system', content: EXPANDER_PROMPT },
      { role: 'user', content: userContent.slice(0, 500) },
    ],
    temperature: 0.1,
    maxTokens,
  });
  for await (const chunk of completion) {
    if (chunk.type === 'text_delta' && chunk.content) content += chunk.content;
    else if (chunk.content) content += chunk.content;
  }
  return content.trim();
}

const expandCache = new Map<string, { keywords: string[]; at: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 64;

function cacheGet(key: string): string[] | null {
  const hit = expandCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    expandCache.delete(key);
    return null;
  }
  return hit.keywords;
}

function cacheSet(key: string, keywords: string[]): void {
  if (expandCache.size >= CACHE_MAX) {
    const oldest = expandCache.keys().next().value;
    if (oldest) expandCache.delete(oldest);
  }
  expandCache.set(key, { keywords, at: Date.now() });
}

export function createCrewKeywordExpander(opts: {
  provider: ProviderInterface;
  model: string;
  timeoutMs?: number;
}): CrewKeywordExpandFn {
  const timeoutMs = opts.timeoutMs ?? 4000;

  return async (message: string): Promise<string[]> => {
    const trimmed = message.trim();
    if (!trimmed || !isExpertiseOpinionQuery(trimmed)) return [];

    const cacheKey = trimmed.toLowerCase();
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const raw = await runLightweightCompletion(opts.provider, opts.model, trimmed);
      const keywords = parseExpandedKeywords(raw);
      if (keywords.length > 0) cacheSet(cacheKey, keywords);
      return keywords;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Build catalog search string from expanded LLM keywords. */
export function buildExpandedSearchQuery(keywords: string[]): string {
  return keywords
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 3)
    .slice(0, 8)
    .join(' ');
}
