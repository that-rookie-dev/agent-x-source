import { describe, it, expect } from 'vitest';
import {
  isExpertiseOpinionQuery,
  parseExpandedKeywords,
} from '../src/crew/crew-keyword-expander.js';
import {
  buildCrewSuggestionSearchQuery,
  extractSubstantiveSearchTokens,
} from '../src/agent/crew-auto-compose.js';

describe('isExpertiseOpinionQuery', () => {
  it('detects subject-matter learning questions', () => {
    expect(isExpertiseOpinionQuery('I need to know about blackholes. Who can help me?')).toBe(true);
  });

  it('rejects generic workforce with no subject', () => {
    expect(isExpertiseOpinionQuery('I need a skilled person')).toBe(false);
  });

  it('rejects social greetings', () => {
    expect(isExpertiseOpinionQuery('thanks!')).toBe(false);
  });
});

describe('parseExpandedKeywords', () => {
  it('parses JSON array from LLM output', () => {
    const raw = 'Here are keywords:\n["astrophysics","astronomy","cosmology"]';
    expect(parseExpandedKeywords(raw)).toEqual(['astrophysics', 'astronomy', 'cosmology']);
  });

  it('parses comma-separated fallback', () => {
    expect(parseExpandedKeywords('astrophysics, astronomy, theoretical physics')).toEqual([
      'astrophysics',
      'astronomy',
      'theoretical physics',
    ]);
  });
});

describe('blackhole query tokenization', () => {
  const msg = 'I need to know about blackholes. Who can help me?';

  it('expands blackhole domain hints and drops filler tokens', () => {
    const tokens = extractSubstantiveSearchTokens(msg);
    expect(tokens).toContain('blackholes');
    expect(tokens).toContain('astrophysics');
    expect(tokens).not.toContain('know');
    expect(tokens).not.toContain('about');
  });

  it('builds a focused search query', () => {
    const query = buildCrewSuggestionSearchQuery(msg);
    expect(query).toContain('blackholes');
    expect(query).toContain('astrophysics');
    expect(query).not.toContain('know');
  });
});
