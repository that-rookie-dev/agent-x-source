import { describe, expect, it, vi } from 'vitest';
import {
  analyzeWebSearchIntent,
  analyzeWebSearchIntentHeuristic,
  createWebSearchIntentClassifier,
  detectExplicitWebSearchRequest,
} from '../src/search/web-search-intent.js';
import { resolveWebSearchTurnPolicy, resolveWebSearchTurnPolicyAsync } from '../src/search/web-search-policy.js';

describe('web-search-intent', () => {
  it('detects explicit search requests', () => {
    expect(detectExplicitWebSearchRequest('search the web for React 19')).toBe(true);
    expect(detectExplicitWebSearchRequest('explain recursion')).toBe(false);
  });

  it('forces search for JWST latest news phrasing', () => {
    const q = 'what is the latest new about James Webb Telescope?';
    const intent = analyzeWebSearchIntentHeuristic(q);
    expect(intent.shouldForceSearch).toBe(true);
    expect(intent.confidence).toBe('high');
  });

  it('forces search for weak latest cue on external topics', () => {
    const intent = analyzeWebSearchIntentHeuristic('latest earnings from Apple');
    expect(intent.shouldForceSearch).toBe(true);
    expect(intent.confidence).toBe('medium');
  });

  it('does not force search for repo-local latest context', () => {
    const intent = analyzeWebSearchIntentHeuristic('show me the latest commit on this branch');
    expect(intent.shouldForceSearch).toBe(false);
    expect(intent.confidence).toBe('high');
  });

  it('does not force search for session chat recency', () => {
    const intent = analyzeWebSearchIntentHeuristic('what was our latest message about taxes?');
    expect(intent.shouldForceSearch).toBe(false);
  });

  it('uses LLM classifier for medium-confidence recency', async () => {
    const classify = vi.fn().mockResolvedValue(false);
    const intent = await analyzeWebSearchIntent('latest design trends for brand logos', classify);
    expect(classify).toHaveBeenCalled();
    expect(intent.source).toBe('llm');
    expect(intent.shouldForceSearch).toBe(false);
  });

  it('skips LLM when heuristic is high confidence', async () => {
    const classify = vi.fn();
    const intent = await analyzeWebSearchIntent(
      'what is the latest news on AI regulation?',
      classify,
    );
    expect(classify).not.toHaveBeenCalled();
    expect(intent.shouldForceSearch).toBe(true);
    expect(intent.confidence).toBe('high');
  });

  it('createWebSearchIntentClassifier caches and parses yes/no', async () => {
    const provider = {
      complete: async function* () {
        yield { type: 'text_delta', content: 'yes\nCurrent events need live sources' };
      },
    };
    const classify = createWebSearchIntentClassifier({
      provider: provider as never,
      model: 'test',
    });
    expect(await classify('latest volcano activity')).toBe(true);
    expect(await classify('latest volcano activity')).toBe(true);
  });
});

describe('resolveWebSearchTurnPolicyAsync', () => {
  it('forces policy for recency questions', async () => {
    const policy = await resolveWebSearchTurnPolicyAsync({
      userText: 'what is the latest new about James Webb Telescope?',
      searchAvailable: true,
    });
    expect(policy).toBe('forced');
  });

  it('keeps auto for timeless questions', async () => {
    expect(resolveWebSearchTurnPolicy({
      userText: 'explain how recursion works',
      searchAvailable: true,
    })).toBe('auto');
    expect(await resolveWebSearchTurnPolicyAsync({
      userText: 'explain how recursion works',
      searchAvailable: true,
    })).toBe('auto');
  });
});
