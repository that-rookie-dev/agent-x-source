import { describe, expect, it } from 'vitest';
import {
  buildWebSearchTurnInstruction,
  detectExplicitWebSearchRequest,
  isWebSearchAvailableForChat,
  pickForcedWebSearchTool,
  resolveWebSearchTurnPolicy,
  resolveWebSearchTurnPolicyAsync,
} from '../src/search/web-search-policy.js';
import { analyzeWebSearchIntentHeuristic } from '../src/search/web-search-intent.js';
import { defaultWebSearchToolsConfig } from '../src/search/search-config.js';
import type { AgentXConfig } from '@agentx/shared';

function baseConfig(overrides: Partial<AgentXConfig> = {}): AgentXConfig {
  return {
    ui: { disabledTools: [] },
    tools: { webSearch: defaultWebSearchToolsConfig() },
    ...overrides,
  } as AgentXConfig;
}

describe('web-search-policy', () => {
  it('detects explicit web search requests', () => {
    expect(detectExplicitWebSearchRequest('search the web for React 19')).toBe(true);
    expect(detectExplicitWebSearchRequest('what is the latest news on AI')).toBe(false);
    expect(analyzeWebSearchIntentHeuristic('what is the latest news on AI').shouldForceSearch).toBe(true);
    expect(detectExplicitWebSearchRequest('explain recursion')).toBe(false);
  });

  it('resolves forced policy from globe, recency, or explicit request', async () => {
    expect(resolveWebSearchTurnPolicy({ forceWebSearch: true, userText: 'hello', searchAvailable: true })).toBe('forced');
    expect(resolveWebSearchTurnPolicy({ userText: 'search the internet for prices', searchAvailable: true })).toBe('forced');
    expect(resolveWebSearchTurnPolicy({
      userText: 'what is the latest new about James Webb Telescope?',
      searchAvailable: true,
    })).toBe('forced');
    expect(await resolveWebSearchTurnPolicyAsync({
      userText: 'what is the latest new about James Webb Telescope?',
      searchAvailable: true,
    })).toBe('forced');
    expect(resolveWebSearchTurnPolicy({ userText: 'hello', searchAvailable: true })).toBe('auto');
    expect(resolveWebSearchTurnPolicy({ forceWebSearch: true, userText: 'hello', searchAvailable: false })).toBe('off');
  });

  it('does not force web search for local places queries', () => {
    expect(resolveWebSearchTurnPolicy({
      userText: 'best stake restaurants in bengaluru',
      searchAvailable: true,
    })).toBe('auto');
    expect(analyzeWebSearchIntentHeuristic('best stake restaurants in bengaluru').shouldForceSearch).toBe(false);
  });

  it('picks deep_web_search before web_search for forced tool', () => {
    expect(pickForcedWebSearchTool([])).toBe('deep_web_search');
    expect(pickForcedWebSearchTool(['deep_web_search'])).toBe('web_search');
    expect(pickForcedWebSearchTool(['deep_web_search', 'web_search'])).toBeNull();
  });

  it('reports availability from providers and enabled tools', () => {
    const cfg = baseConfig();
    const status = isWebSearchAvailableForChat(cfg);
    expect(status.tools.deep_web_search).toBe(true);
    expect(status.forcedTool).toBe('deep_web_search');
    expect(status.available).toBe(true);
  });

  it('builds instruction blocks for auto and forced modes', () => {
    expect(buildWebSearchTurnInstruction('off')).toBe('');
    expect(buildWebSearchTurnInstruction('auto')).toContain('WEB SEARCH — AUTO');
    expect(buildWebSearchTurnInstruction('forced')).toContain('MUST call');
  });
});
