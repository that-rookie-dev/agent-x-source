import type { AgentXConfig, WebSearchPaidProviderId, WebSearchToolsConfig } from '@agentx/shared';

export type ResolvedWebSearchProvider = 'duckduckgo' | WebSearchPaidProviderId;

export interface ResolvedWebSearchRuntime {
  duckduckgo: boolean;
  brave?: string;
  exa?: string;
  tavily?: string;
}

const DEFAULT_RUNTIME: ResolvedWebSearchRuntime = { duckduckgo: true };

let runtime: ResolvedWebSearchRuntime = { ...DEFAULT_RUNTIME };

export function getWebSearchRuntime(): Readonly<ResolvedWebSearchRuntime> {
  return runtime;
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
  };
}

export function listActiveWebSearchProviders(rt: ResolvedWebSearchRuntime = runtime): ResolvedWebSearchProvider[] {
  const out: ResolvedWebSearchProvider[] = [];
  if (rt.duckduckgo) out.push('duckduckgo');
  if (rt.brave) out.push('brave');
  if (rt.exa) out.push('exa');
  if (rt.tavily) out.push('tavily');
  return out;
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
  };
}

export function hasActiveWebSearchProviders(rt: ResolvedWebSearchRuntime = runtime): boolean {
  return listActiveWebSearchProviders(rt).length > 0;
}

export function webSearchProvidersUnavailableMessage(): string {
  return 'No web search providers are active. Enable DuckDuckGo or configure a BYOK provider (Brave, Exa, Tavily) in Settings → Tools → Web Search.';
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
      apiKey: inc.brave?.apiKey !== undefined ? inc.brave.apiKey : ex.brave?.apiKey,
    },
    exa: {
      enabled: inc.exa?.enabled ?? ex.exa?.enabled ?? base.exa!.enabled,
      apiKey: inc.exa?.apiKey !== undefined ? inc.exa.apiKey : ex.exa?.apiKey,
    },
    tavily: {
      enabled: inc.tavily?.enabled ?? ex.tavily?.enabled ?? base.tavily!.enabled,
      apiKey: inc.tavily?.apiKey !== undefined ? inc.tavily.apiKey : ex.tavily?.apiKey,
    },
  };
}
