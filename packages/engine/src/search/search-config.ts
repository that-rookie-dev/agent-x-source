import type { AgentXConfig, WebSearchPaidProviderId, WebSearchProviderId, WebSearchToolsConfig } from '@agentx/shared';

export type ResolvedWebSearchProvider = WebSearchProviderId;

export interface ResolvedWebSearchRuntime {
  duckduckgo: boolean;
  brave?: string;
  exa?: string;
  tavily?: string;
  /** Normalized try-order (all known providers; inactive skipped by listActive). */
  providerOrder: ResolvedWebSearchProvider[];
}

export const DEFAULT_WEB_SEARCH_PROVIDER_ORDER: ResolvedWebSearchProvider[] = [
  'duckduckgo',
  'brave',
  'exa',
  'tavily',
];

const DEFAULT_RUNTIME: ResolvedWebSearchRuntime = {
  duckduckgo: true,
  providerOrder: [...DEFAULT_WEB_SEARCH_PROVIDER_ORDER],
};

let runtime: ResolvedWebSearchRuntime = { ...DEFAULT_RUNTIME, providerOrder: [...DEFAULT_WEB_SEARCH_PROVIDER_ORDER] };

export function getWebSearchRuntime(): Readonly<ResolvedWebSearchRuntime> {
  return runtime;
}

export function normalizeWebSearchProviderOrder(
  order?: WebSearchProviderId[] | null,
): ResolvedWebSearchProvider[] {
  const out: ResolvedWebSearchProvider[] = [];
  const seen = new Set<ResolvedWebSearchProvider>();
  for (const id of order ?? []) {
    if (!DEFAULT_WEB_SEARCH_PROVIDER_ORDER.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of DEFAULT_WEB_SEARCH_PROVIDER_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function isProviderReady(rt: ResolvedWebSearchRuntime, id: ResolvedWebSearchProvider): boolean {
  if (id === 'duckduckgo') return rt.duckduckgo;
  return Boolean(rt[id as WebSearchPaidProviderId]);
}

export function resolveWebSearchRuntime(config?: WebSearchToolsConfig | null): ResolvedWebSearchRuntime {
  const ws = config ?? {};
  const duckduckgo = ws.duckduckgo?.enabled !== false;

  const braveKey = ws.brave?.enabled && ws.brave.apiKey?.trim() ? ws.brave.apiKey.trim() : undefined;
  const exaKey = ws.exa?.enabled && ws.exa.apiKey?.trim() ? ws.exa.apiKey.trim() : undefined;
  const tavilyKey = ws.tavily?.enabled && ws.tavily.apiKey?.trim() ? ws.tavily.apiKey.trim() : undefined;

  return {
    duckduckgo,
    ...(braveKey ? { brave: braveKey } : {}),
    ...(exaKey ? { exa: exaKey } : {}),
    ...(tavilyKey ? { tavily: tavilyKey } : {}),
    providerOrder: normalizeWebSearchProviderOrder(ws.providerOrder),
  };
}

export function listActiveWebSearchProviders(rt: ResolvedWebSearchRuntime = runtime): ResolvedWebSearchProvider[] {
  return rt.providerOrder.filter((id) => isProviderReady(rt, id));
}

export function applyWebSearchConfigFromAgentConfig(cfg: AgentXConfig | null | undefined): ResolvedWebSearchRuntime {
  runtime = resolveWebSearchRuntime(cfg?.tools?.webSearch);
  return runtime;
}

export function defaultWebSearchToolsConfig(): WebSearchToolsConfig {
  return {
    duckduckgo: { enabled: true },
    brave: { enabled: false },
    exa: { enabled: false },
    tavily: { enabled: false },
    providerOrder: [...DEFAULT_WEB_SEARCH_PROVIDER_ORDER],
  };
}

export function hasActiveWebSearchProviders(rt: ResolvedWebSearchRuntime = runtime): boolean {
  return listActiveWebSearchProviders(rt).length > 0;
}

export function webSearchProvidersUnavailableMessage(): string {
  return 'No web search providers are active. Enable DuckDuckGo or configure a BYOK provider (Brave, Exa, Tavily) in Settings → Tools → Web Search.';
}

/** True for legacy client placeholders (bullet redaction) that must never be persisted. */
function isUnusableApiKeyPlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // Former REDACTED_SECRET was U+2022 bullets — invalid in HTTP headers if saved.
  if (/^•+$/.test(v) || v.includes('•')) return true;
  if (v === '••••••••' || v === '***' || v === '********') return true;
  return false;
}

/**
 * Merge a paid search provider key.
 * - New non-empty key → store it
 * - `apiKeyConfigured: false` → clear stored key
 * - Missing / empty / legacy placeholder → keep existing secret
 */
function mergePaidProviderKey(
  existing?: { apiKey?: string },
  incoming?: { apiKey?: string; apiKeyConfigured?: boolean },
): string | undefined {
  if (!incoming) return existing?.apiKey;
  if (incoming.apiKeyConfigured === false) return '';
  const next = typeof incoming.apiKey === 'string' ? incoming.apiKey.trim() : undefined;
  if (next && !isUnusableApiKeyPlaceholder(next)) return next;
  return existing?.apiKey;
}

export function mergeWebSearchToolsConfig(
  existing?: WebSearchToolsConfig | null,
  incoming?: WebSearchToolsConfig | null,
): WebSearchToolsConfig {
  const base = defaultWebSearchToolsConfig();
  const ex = existing ?? {};
  const inc = incoming ?? {};
  return {
    duckduckgo: {
      enabled: inc.duckduckgo?.enabled ?? ex.duckduckgo?.enabled ?? base.duckduckgo!.enabled,
    },
    brave: {
      enabled: inc.brave?.enabled ?? ex.brave?.enabled ?? base.brave!.enabled,
      apiKey: mergePaidProviderKey(ex.brave, inc.brave),
    },
    exa: {
      enabled: inc.exa?.enabled ?? ex.exa?.enabled ?? base.exa!.enabled,
      apiKey: mergePaidProviderKey(ex.exa, inc.exa),
    },
    tavily: {
      enabled: inc.tavily?.enabled ?? ex.tavily?.enabled ?? base.tavily!.enabled,
      apiKey: mergePaidProviderKey(ex.tavily, inc.tavily),
    },
    providerOrder: normalizeWebSearchProviderOrder(
      inc.providerOrder ?? ex.providerOrder ?? base.providerOrder,
    ),
  };
}
