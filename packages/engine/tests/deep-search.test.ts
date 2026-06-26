import { describe, it, expect } from 'vitest';
import { planSearchQueries, depthBudget } from '../src/search/planner.js';
import { preScoreSerpHit } from '../src/search/score.js';
import { isUrlSafeForFetch, canonicalizeUrl } from '../src/search/url-utils.js';

describe('deep search planner', () => {
  it('creates multiple sub-queries for standard depth', () => {
    const plan = planSearchQueries('black hole event horizon', 'standard');
    expect(plan.subQueries.length).toBeGreaterThan(1);
    expect(plan.subQueries[0]).toContain('black hole');
  });

  it('uses single query for quick depth', () => {
    const plan = planSearchQueries('weather today', 'quick');
    expect(plan.subQueries).toHaveLength(1);
  });

  it('detects video intent', () => {
    const plan = planSearchQueries('best youtube documentaries about space', 'standard');
    expect(plan.intent).toContain('video');
  });
});

describe('depthBudget', () => {
  it('returns larger budgets for deep mode', () => {
    expect(depthBudget('deep').fetchCount).toBeGreaterThan(depthBudget('quick').fetchCount);
  });
});

describe('preScoreSerpHit', () => {
  it('ranks authoritative domains higher for same relevance', () => {
    const query = 'nasa james webb telescope';
    const nasa = preScoreSerpHit(query, {
      title: 'James Webb Telescope',
      url: 'https://nasa.gov/webb',
      snippet: 'NASA james webb telescope discoveries',
      domain: 'nasa.gov',
      provider: 'brave',
      rank: 1,
    });
    const blog = preScoreSerpHit(query, {
      title: 'James Webb blog',
      url: 'https://random-blog.example/post',
      snippet: 'james webb telescope',
      domain: 'random-blog.example',
      provider: 'duckduckgo',
      rank: 2,
    });
    expect(nasa).toBeGreaterThan(blog);
  });
});

describe('url utils', () => {
  it('blocks localhost fetches', () => {
    expect(isUrlSafeForFetch('http://localhost:3000')).toBe(false);
    expect(isUrlSafeForFetch('https://example.com/article')).toBe(true);
  });

  it('canonicalizes trailing slashes', () => {
    expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });
});
