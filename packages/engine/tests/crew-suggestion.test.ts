import { describe, it, expect } from 'vitest';
import {
  evaluateSuggestionGate,
  scoreMatchCandidates,
  shouldShowSuggestion,
  type RawMatchRow,
} from '../src/crew/CrewMatchService.js';
import { buildCrewSuggestionSearchQuery } from '../src/agent/crew-auto-compose.js';

describe('evaluateSuggestionGate', () => {
  it('blocks when @mention is present', () => {
    const result = evaluateSuggestionGate({
      message: '@tax_advisor help me file',
      dismissed: false,
      hasAtMention: true,
      explicitCrewRequest: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('at-mention');
  });

  it('blocks when session dismissed without explicit crew request', () => {
    const result = evaluateSuggestionGate({
      message: 'Please help me build a tax planning strategy for freelancers',
      dismissed: true,
      hasAtMention: false,
      explicitCrewRequest: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('session-dismissed');
  });

  it('passes for task-like messages when not dismissed', () => {
    const result = evaluateSuggestionGate({
      message: 'Help me prepare my income tax return and maximize deductions',
      dismissed: false,
      hasAtMention: false,
      explicitCrewRequest: false,
    });
    expect(result.pass).toBe(true);
  });

  it('buildCrewSuggestionSearchQuery focuses domain tokens for vacation messages', () => {
    const msg = 'I am planning for a international vacation with my wife and new born baby girl.';
    const query = buildCrewSuggestionSearchQuery(msg);
    expect(query).toContain('travel');
    expect(query).not.toMatch(/\bam\b/);
    expect(query.split(' ').length).toBeLessThanOrEqual(8);
  });

  it('passes when dismissed but user explicitly requests crew', () => {
    const result = evaluateSuggestionGate({
      message: 'Please involve the crew for tax planning help',
      dismissed: true,
      hasAtMention: false,
      explicitCrewRequest: true,
    });
    expect(result.pass).toBe(true);
  });

  it('does not blanket-block when crew is active — gate stays open for new requirements', () => {
    const result = evaluateSuggestionGate({
      message: 'Help me plan a beach vacation itinerary',
      dismissed: false,
      hasAtMention: false,
      explicitCrewRequest: false,
      priorUserMessages: ['Build my tax return for 2024'],
    });
    expect(result.pass).toBe(true);
  });

  it('passes for workforce / skilled-person requests without domain task verbs', () => {
    const result = evaluateSuggestionGate({
      message: 'I need a skilled person',
      dismissed: false,
      hasAtMention: false,
      explicitCrewRequest: false,
    });
    expect(result.pass).toBe(true);
    expect(result.reasons).toContain('workforce-intent');
  });
});

describe('scoreMatchCandidates', () => {
  const rows: RawMatchRow[] = [
    {
      id: 'hub-tax',
      origin: 'hub_catalog',
      callsign: 'tax_pro',
      name: 'Tax Pro',
      title: 'Tax Advisor',
      description: 'Tax specialist',
      expertise: ['tax', 'finance'],
      traits: ['analytical'],
      catalogId: 'hub-tax',
      onRoster: false,
      ftsRank: 0.7,
      systemPrompt: 'You are a tax advisor',
    },
    {
      id: 'custom-1',
      origin: 'custom',
      callsign: 'my_tax',
      name: 'My Tax Bot',
      title: 'Custom Tax',
      description: 'Personal tax helper',
      expertise: ['tax', 'finance'],
      traits: [],
      onRoster: true,
      enabled: true,
      ftsRank: 0.7,
      systemPrompt: 'Custom tax crew specializing in tax return filing',
    },
  ];

  it('ranks custom crew above hub when scores are close', () => {
    const scored = scoreMatchCandidates('tax return filing help', rows);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0]?.origin).toBe('custom');
  });

  it('shouldShowSuggestion respects threshold', () => {
    const high = [{ id: 'a', origin: 'custom' as const, callsign: 'a', name: 'A', title: 'T', description: '', expertise: [], traits: [], matchScore: 0.5, reasons: [], onRoster: true }];
    const low = [{ id: 'b', origin: 'custom' as const, callsign: 'b', name: 'B', title: 'T', description: '', expertise: [], traits: [], matchScore: 0.2, reasons: [], onRoster: true }];
    expect(shouldShowSuggestion(high)).toBe(true);
    expect(shouldShowSuggestion(low)).toBe(false);
  });

  it('shouldShowSuggestion accepts custom threshold for active-crew path', () => {
    const mid = [{ id: 'a', origin: 'custom' as const, callsign: 'a', name: 'A', title: 'T', description: '', expertise: [], traits: [], matchScore: 0.45, reasons: [], onRoster: true }];
    expect(shouldShowSuggestion(mid, 0.38)).toBe(true);
    expect(shouldShowSuggestion(mid, 0.52)).toBe(false);
  });
});
