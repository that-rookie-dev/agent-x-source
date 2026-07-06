import { describe, expect, it } from 'vitest';
import { shouldOfferCrewRosterPicker } from '../src/chat/crew-suggestion-flow';
import type { CrewSuggestionEvaluation } from '@agentx/shared/browser';

function evalWith(candidateCount: number, shouldSuggest = true): CrewSuggestionEvaluation {
  return {
    shouldSuggest,
    dismissed: false,
    confidence: 0.8,
    taskSummary: 'task',
    candidates: Array.from({ length: candidateCount }, (_, i) => ({
      id: `c${i}`,
      origin: 'hub_catalog' as const,
      callsign: `crew${i}`,
      name: `Crew ${i}`,
      title: 'Specialist',
      description: '',
      expertise: [],
      traits: [],
      matchScore: 0.8,
      reasons: [],
      onRoster: false,
    })),
    reasons: [],
  };
}

describe('shouldOfferCrewRosterPicker', () => {
  it('offers when candidates exist regardless of shouldSuggest', () => {
    expect(shouldOfferCrewRosterPicker(evalWith(2, true))).toBe(true);
    expect(shouldOfferCrewRosterPicker(evalWith(1, false))).toBe(true);
  });

  it('skips when there are no candidates', () => {
    expect(shouldOfferCrewRosterPicker(evalWith(0, true))).toBe(false);
  });
});
