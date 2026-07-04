import type { AgentXConfig } from '@agentx/shared';
import { hasActiveWebSearchProviders, listActiveWebSearchProviders } from './search-config.js';
import {
  analyzeWebSearchIntent,
  analyzeWebSearchIntentHeuristic,
  type WebSearchIntentClassifier,
} from './web-search-intent.js';

export type { WebSearchIntentAnalysis, WebSearchIntentClassifier } from './web-search-intent.js';
export {
  analyzeWebSearchIntent,
  analyzeWebSearchIntentHeuristic,
  createWebSearchIntentClassifier,
  detectExplicitWebSearchRequest,
} from './web-search-intent.js';

export type WebSearchTurnPolicy = 'forced' | 'auto' | 'off';

export async function resolveWebSearchTurnPolicyAsync(input: {
  forceWebSearch?: boolean;
  userText: string;
  searchAvailable: boolean;
  classifyIntent?: WebSearchIntentClassifier;
}): Promise<WebSearchTurnPolicy> {
  if (!input.searchAvailable) return 'off';
  if (input.forceWebSearch) return 'forced';

  const intent = await analyzeWebSearchIntent(input.userText, input.classifyIntent);
  if (intent.shouldForceSearch) return 'forced';
  return 'auto';
}

export function resolveWebSearchTurnPolicy(input: {
  forceWebSearch?: boolean;
  userText: string;
  searchAvailable: boolean;
}): WebSearchTurnPolicy {
  if (!input.searchAvailable) return 'off';
  if (input.forceWebSearch) return 'forced';
  const intent = analyzeWebSearchIntentHeuristic(input.userText);
  if (intent.shouldForceSearch) return 'forced';
  return 'auto';
}

export function pickForcedWebSearchTool(disabledTools: string[] = []): 'deep_web_search' | 'web_search' | null {
  const disabled = new Set(disabledTools);
  if (!disabled.has('deep_web_search')) return 'deep_web_search';
  if (!disabled.has('web_search')) return 'web_search';
  return null;
}

export function isWebSearchAvailableForChat(cfg: AgentXConfig): {
  available: boolean;
  providers: string[];
  tools: { deep_web_search: boolean; web_search: boolean };
  forcedTool: 'deep_web_search' | 'web_search' | null;
} {
  const disabled = cfg.ui?.disabledTools ?? [];
  const deepEnabled = !disabled.includes('deep_web_search');
  const quickEnabled = !disabled.includes('web_search');
  const providers = hasActiveWebSearchProviders() ? [...listActiveWebSearchProviders()] : [];
  const hasProvider = providers.length > 0;
  const toolsEnabled = deepEnabled || quickEnabled;
  const forcedTool = pickForcedWebSearchTool(disabled);
  return {
    available: hasProvider && toolsEnabled && forcedTool !== null,
    providers,
    tools: { deep_web_search: deepEnabled, web_search: quickEnabled },
    forcedTool,
  };
}

export function buildWebSearchTurnInstruction(policy: WebSearchTurnPolicy): string {
  if (policy === 'off') return '';
  if (policy === 'forced') {
    return `[WEB SEARCH — REQUIRED THIS TURN]
You MUST call a web search tool before answering — UNLESS the user is asking for local places, restaurants, directions, or addresses and Google Maps MCP integration tools are available (use integration__google-maps__* instead).
- Prefer deep_web_search for the user's question (full research pipeline with ranked sources).
- Use web_search only if deep_web_search is unavailable.
- Do NOT answer from memory alone for factual/current claims — search first, then synthesize.
- MANDATORY: Every web-sourced fact, news item, or bullet MUST end with a source chip link: [domain.com](full-url). Never omit the source.
[/WEB SEARCH]`;
  }
  return `[WEB SEARCH — AUTO]
Use web search tools when ANY of these apply:
1. The user asks about current events, live data, prices, weather, releases, or recency ("latest", "recent", "today", "current").
2. You are uncertain, guessing, or your knowledge may be outdated — verify via deep_web_search (preferred) or web_search.
3. You need to confirm conflicting facts before advising.
If the user asks for restaurants, hotels, nearby places, or directions, prefer Google Maps MCP (integration__google-maps__maps_search_places) over web search when connected.
If none apply and you are confident from context/files, answer without searching.
When you use web data: MANDATORY source chip on every cited item — [domain.com](full-url). No exceptions.
[/WEB SEARCH]`;
}
