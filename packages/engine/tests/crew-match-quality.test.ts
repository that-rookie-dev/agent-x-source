import { describe, it, expect } from 'vitest';
import {
  hasSubstantiveKeywordMatch,
  filterSubstantiveMatches,
} from '../src/crew/crew-match-quality.js';
import type { RawMatchRow } from '../src/crew/CrewMatchService.js';

function row(overrides: Partial<RawMatchRow> & Pick<RawMatchRow, 'title'>): RawMatchRow {
  return {
    id: 'x',
    origin: 'hub_catalog',
    callsign: 'test',
    name: 'Test',
    description: '',
    expertise: [],
    traits: [],
    onRoster: false,
    ftsRank: 1,
    ...overrides,
  };
}

describe('hasSubstantiveKeywordMatch', () => {
  it('accepts real domain overlap', () => {
    const r = row({
      title: 'Astrophysics Theory Coach',
      categoryLabel: 'Theoretical Physical Sciences',
    });
    expect(hasSubstantiveKeywordMatch(r, ['astrophysics'])).toBe(true);
  });

  it('rejects knowledge-only prefix noise', () => {
    const r = row({
      title: 'USMLE Step 2 Clinical Knowledge Coach',
      categoryLabel: 'Medical Certification Prep',
    });
    expect(hasSubstantiveKeywordMatch(r, ['know', 'about', 'blackholes'])).toBe(false);
  });

  it('matches expanded LLM keywords', () => {
    const r = row({
      title: 'Observational Astronomer Advisor',
      categoryLabel: 'Space Science & Astronomy',
    });
    expect(hasSubstantiveKeywordMatch(r, ['astronomy', 'space'])).toBe(true);
  });
});

describe('filterSubstantiveMatches', () => {
  it('returns empty when no substantive tokens', () => {
    const rows = [row({ title: 'Knowledge Base Manager' })];
    expect(filterSubstantiveMatches(rows, ['know', 'about'])).toEqual([]);
  });
});
