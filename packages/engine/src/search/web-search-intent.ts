import type { ProviderInterface } from '../providers/ProviderInterface.js';

export type WebSearchIntentConfidence = 'high' | 'medium' | 'low';
export type WebSearchIntentSource = 'globe' | 'explicit' | 'heuristic' | 'llm' | 'default';

export interface WebSearchIntentAnalysis {
  shouldForceSearch: boolean;
  confidence: WebSearchIntentConfidence;
  reason: string;
  source: WebSearchIntentSource;
}

/** User explicitly asked to search the web. */
const EXPLICIT_WEB_SEARCH_RE = /\b(?:search\s+(?:the\s+)?(?:web|internet|online)|(?:web|internet|online)\s+search|search\s+online|look\s+(?:it\s+)?up\s+online|google\s+(?:for\s+)?|find\s+(?:on\s+)?(?:the\s+)?(?:web|internet)|browse\s+(?:the\s+)?(?:web|internet))\b/i;

/** Strong recency — live web data is almost always required. */
const STRONG_RECENCY_RE = [
  /\b(?:what|who|when|where)\s+(?:is|are|'s)\s+the\s+latest\b/i,
  /\b(?:latest|recent|current|new)\s+(?:news|updates?|developments?|headlines?|reports?|findings?)\b/i,
  /\b(?:any|the)\s+news\s+(?:on|about|regarding|from)\b/i,
  /\bwhat(?:'s|\s+has)\s+been\s+happening\b/i,
  /\b(?:breaking|just\s+announced|just\s+released|announced\s+today)\b/i,
  /\b(?:today'?s?|this\s+(?:week|month|year)'?s?)\s+(?:news|update|weather|price|market)\b/i,
  /\bup[\s-]to[\s-]date\s+(?:info|information|news|details|on)\b/i,
  /\bcurrent\s+(?:news|price|prices|weather|status|version|rate|rates)\b/i,
] as const;

/** Weak recency cue — usually needs web search, but check local/static context first. */
const WEAK_RECENCY_RE = /\b(?:latest|recent(?:ly)?|currently|current|newest|upcoming)\b/i;

/** "Latest" refers to repo/session/code — not the public web. */
const STATIC_OR_LOCAL_RECENCY_RE = [
  /\b(?:latest|last|recent)\s+(?:commit|push|build|deploy|release|tag|merge|pr|pull\s+request)\b/i,
  /\b(?:latest|last|recent)\s+(?:message|turn|reply|response|session|chat)\b/i,
  /\b(?:in|from|our|this)\s+(?:repo|repository|codebase|project|workspace|session|chat|conversation|branch)\b/i,
  /\b(?:git\s+(?:log|status|diff|show)|git\s+history)\b/i,
  /\b(?:this\s+file|the\s+file|line\s+\d+|function\s+\w+|class\s+\w+)\b/i,
  /\b(?:package\.json|tsconfig|dockerfile|readme)\b/i,
] as const;

const CLASSIFIER_PROMPT = `You decide if a user message needs LIVE WEB SEARCH (recent news, prices, releases, events) vs can be answered from general knowledge, code, or session context alone.

Answer YES when:
- The topic is news, current events, market data, weather, product releases, or "latest/recent" developments in the world
- The answer changes over time and a current source would materially improve accuracy

Answer NO when:
- Timeless concepts, math, coding help, file/repo/session state, or opinions
- "Latest" clearly means chat history, git, local project, or already-provided context
- The user is asking Agent-X to edit, debug, or explain their own project

Reply with exactly two lines:
Line 1: yes or no (lowercase)
Line 2: one short reason`;

export type WebSearchIntentClassifier = (message: string) => Promise<boolean>;

export function detectExplicitWebSearchRequest(text: string): boolean {
  return EXPLICIT_WEB_SEARCH_RE.test(text.trim());
}

function isStaticOrLocalRecencyContext(text: string): boolean {
  return STATIC_OR_LOCAL_RECENCY_RE.some((re) => re.test(text));
}

function hasStrongRecencySignal(text: string): boolean {
  return STRONG_RECENCY_RE.some((re) => re.test(text));
}

function hasWeakRecencySignal(text: string): boolean {
  return WEAK_RECENCY_RE.test(text);
}

/** Fast heuristic — no LLM. */
export function analyzeWebSearchIntentHeuristic(text: string): WebSearchIntentAnalysis {
  const trimmed = text.trim();
  const no: WebSearchIntentAnalysis = {
    shouldForceSearch: false,
    confidence: 'low',
    reason: 'No recency or web-search signals',
    source: 'default',
  };
  if (!trimmed) return no;

  if (detectExplicitWebSearchRequest(trimmed)) {
    return {
      shouldForceSearch: true,
      confidence: 'high',
      reason: 'Explicit web search request',
      source: 'explicit',
    };
  }

  if (isStaticOrLocalRecencyContext(trimmed)) {
    return {
      shouldForceSearch: false,
      confidence: 'high',
      reason: 'Recency refers to local repo/session context, not the web',
      source: 'heuristic',
    };
  }

  if (hasStrongRecencySignal(trimmed)) {
    return {
      shouldForceSearch: true,
      confidence: 'high',
      reason: 'Strong recency or current-events signal',
      source: 'heuristic',
    };
  }

  if (hasWeakRecencySignal(trimmed)) {
    return {
      shouldForceSearch: true,
      confidence: 'medium',
      reason: 'Weak recency cue (latest/recent/current) — web search likely needed',
      source: 'heuristic',
    };
  }

  return no;
}

function parseClassifierYesNo(raw: string): boolean | null {
  const line = raw.trim().split('\n').map((l) => l.trim())[0]?.toLowerCase() ?? '';
  if (line.startsWith('yes')) return true;
  if (line.startsWith('no')) return false;
  return null;
}

async function runLightweightCompletion(
  provider: ProviderInterface,
  model: string,
  userContent: string,
  maxTokens = 80,
): Promise<string> {
  let content = '';
  const completion = provider.complete({
    model,
    messages: [
      { role: 'system', content: CLASSIFIER_PROMPT },
      { role: 'user', content: userContent.slice(0, 500) },
    ],
    temperature: 0,
    maxTokens,
  });
  for await (const chunk of completion) {
    if (chunk.type === 'text_delta' && chunk.content) content += chunk.content;
    else if (chunk.content) content += chunk.content;
  }
  return content.trim();
}

const intentCache = new Map<string, { needsSearch: boolean; at: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 64;

export function createWebSearchIntentClassifier(opts: {
  provider: ProviderInterface;
  model: string;
  timeoutMs?: number;
}): WebSearchIntentClassifier {
  const timeoutMs = opts.timeoutMs ?? 3500;

  return async (message: string): Promise<boolean> => {
    const trimmed = message.trim();
    if (!trimmed) return false;

    const cacheKey = trimmed.toLowerCase();
    const cached = intentCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.needsSearch;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const raw = await runLightweightCompletion(opts.provider, opts.model, trimmed);
      const parsed = parseClassifierYesNo(raw);
      const needsSearch = parsed ?? hasWeakRecencySignal(trimmed);
      if (intentCache.size >= CACHE_MAX) {
        const oldest = intentCache.keys().next().value;
        if (oldest) intentCache.delete(oldest);
      }
      intentCache.set(cacheKey, { needsSearch, at: Date.now() });
      return needsSearch;
    } catch {
      return hasWeakRecencySignal(trimmed);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Heuristic first; optional LLM refines medium-confidence recency cases. */
export async function analyzeWebSearchIntent(
  text: string,
  classify?: WebSearchIntentClassifier,
): Promise<WebSearchIntentAnalysis> {
  const heuristic = analyzeWebSearchIntentHeuristic(text);

  if (heuristic.confidence === 'high' || heuristic.source === 'explicit') {
    return heuristic;
  }

  if (heuristic.confidence !== 'medium' || !classify) {
    return heuristic;
  }

  const needsSearch = await classify(text);
  return {
    shouldForceSearch: needsSearch,
    confidence: 'medium',
    reason: needsSearch
      ? 'LLM classified as needing live web information'
      : 'LLM classified as answerable without web search',
    source: 'llm',
  };
}
