import type { DeepSearchResult, DeepSearchResultBundle } from '@agentx/shared/browser';

const SEARCH_PROVIDER_LABELS: Record<string, string> = {
  duckduckgo: 'DuckDuckGo',
  brave: 'Brave',
  exa: 'Exa',
  tavily: 'Tavily',
};

export function formatSearchProviderLabel(providerId: string): string {
  const key = providerId.trim().toLowerCase();
  return SEARCH_PROVIDER_LABELS[key] ?? providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

export function collectSearchProviders(
  bundle?: DeepSearchResultBundle | null,
  results?: DeepSearchResult[],
): string[] {
  const fromStats = bundle?.stats?.providers ?? [];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const id of fromStats) {
    const key = id.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(formatSearchProviderLabel(id));
  }
  const rows = results ?? bundle?.results ?? [];
  for (const row of rows) {
    const id = row.source?.provider?.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    labels.push(formatSearchProviderLabel(id));
  }
  return labels;
}

export function formatSearchProvidersList(
  bundle?: DeepSearchResultBundle | null,
  results?: DeepSearchResult[],
): string | null {
  const labels = collectSearchProviders(bundle, results);
  return labels.length > 0 ? labels.join(' · ') : null;
}
