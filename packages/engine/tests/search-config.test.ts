import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyWebSearchConfigFromAgentConfig,
  getWebSearchRuntime,
  listActiveWebSearchProviders,
  resolveWebSearchRuntime,
  hasActiveWebSearchProviders,
  mergeWebSearchToolsConfig,
  webSearchProvidersUnavailableMessage,
} from '../src/search/search-config.js';
import type { AgentXConfig } from '@agentx/shared';

function minimalConfig(tools?: AgentXConfig['tools']): AgentXConfig {
  return {
    provider: { activeProvider: 'openai', activeModel: 'gpt-4', providers: {} },
    ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
    organization: null,
    telemetry: false,
    tools,
  };
}

describe('search-config', () => {
  beforeEach(() => {
    applyWebSearchConfigFromAgentConfig(minimalConfig());
  });

  it('defaults to DuckDuckGo only', () => {
    const rt = resolveWebSearchRuntime(undefined);
    expect(rt.duckduckgo).toBe(true);
    expect(rt.brave).toBeUndefined();
    expect(listActiveWebSearchProviders(rt)).toEqual(['duckduckgo']);
  });

  it('enables paid providers only when enabled with api key', () => {
    const rt = resolveWebSearchRuntime({
      duckduckgo: { enabled: true },
      brave: { enabled: true, apiKey: 'bsa-test' },
      exa: { enabled: true, apiKey: '' },
      tavily: { enabled: false, apiKey: 'tvly-test' },
    });
    expect(rt.brave).toBe('bsa-test');
    expect(rt.exa).toBeUndefined();
    expect(rt.tavily).toBeUndefined();
    expect(listActiveWebSearchProviders(rt)).toEqual(['duckduckgo', 'brave']);
  });

  it('allows disabling DuckDuckGo', () => {
    const rt = resolveWebSearchRuntime({
      duckduckgo: { enabled: false },
      brave: { enabled: true, apiKey: 'bsa-key' },
    });
    expect(rt.duckduckgo).toBe(false);
    expect(listActiveWebSearchProviders(rt)).toEqual(['brave']);
  });

  it('applyWebSearchConfigFromAgentConfig updates runtime', () => {
    applyWebSearchConfigFromAgentConfig(minimalConfig({
      webSearch: {
        duckduckgo: { enabled: false },
        exa: { enabled: true, apiKey: 'exa-key' },
      },
    }));
    const rt = getWebSearchRuntime();
    expect(rt.duckduckgo).toBe(false);
    expect(rt.exa).toBe('exa-key');
  });

  it('mergeWebSearchToolsConfig preserves api keys on partial updates', () => {
    const merged = mergeWebSearchToolsConfig(
      { brave: { enabled: true, apiKey: 'keep-me' } },
      { brave: { enabled: false } },
    );
    expect(merged.brave?.apiKey).toBe('keep-me');
    expect(merged.brave?.enabled).toBe(false);
  });

  it('reports no active providers when all disabled', () => {
    const rt = resolveWebSearchRuntime({
      duckduckgo: { enabled: false },
      brave: { enabled: false },
    });
    expect(hasActiveWebSearchProviders(rt)).toBe(false);
    expect(webSearchProvidersUnavailableMessage()).toContain('Settings');
  });
});
