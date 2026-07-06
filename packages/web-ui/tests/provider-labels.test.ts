import { describe, expect, it } from 'vitest';
import {
  collectSearchProviders,
  formatSearchProviderLabel,
  formatSearchProvidersList,
} from '../src/components/deep-search/provider-labels';
import type { DeepSearchResult } from '@agentx/shared/browser';

function makeResult(provider: string): DeepSearchResult {
  return {
    id: provider,
    url: `https://${provider}.example/a`,
    title: 'Example',
    snippet: 'snippet',
    domain: `${provider}.example`,
    contentType: 'article',
    scores: { relevance: 1, authority: 1, freshness: 1, extractQuality: 1, typeFit: 1, final: 1 },
    extracted: {},
    source: { provider, fetchedAt: '2026-01-01T00:00:00.000Z' },
  };
}

describe('search provider labels', () => {
  it('formats known provider ids', () => {
    expect(formatSearchProviderLabel('duckduckgo')).toBe('DuckDuckGo');
    expect(formatSearchProviderLabel('brave')).toBe('Brave');
    expect(formatSearchProviderLabel('exa')).toBe('Exa');
    expect(formatSearchProviderLabel('tavily')).toBe('Tavily');
  });

  it('collects unique providers from results', () => {
    const results = [makeResult('duckduckgo'), makeResult('brave'), makeResult('duckduckgo')];
    expect(collectSearchProviders(null, results)).toEqual(['DuckDuckGo', 'Brave']);
    expect(formatSearchProvidersList(null, results)).toBe('DuckDuckGo · Brave');
  });
});
