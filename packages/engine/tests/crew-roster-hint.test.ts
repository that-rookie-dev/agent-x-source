import { describe, expect, it } from 'vitest';
import { buildCrewRosterHintFromEvaluation } from '../src/crew/crew-roster-hint.js';
import type { CrewSuggestionEvaluation } from '@agentx/shared';

function evalWith(candidates: CrewSuggestionEvaluation['candidates'], shouldSuggest: boolean): CrewSuggestionEvaluation {
  return {
    shouldSuggest,
    dismissed: false,
    confidence: candidates[0]?.matchScore ?? 0,
    taskSummary: 'test',
    candidates,
    reasons: [],
  };
}

describe('buildCrewRosterHintFromEvaluation', () => {
  it('returns null when modal would have shown', () => {
    const hint = buildCrewRosterHintFromEvaluation(
      evalWith([{
        id: 'a', origin: 'hub_catalog', callsign: 'tax_pro', name: 'Tax Pro', title: 'Tax Advisor',
        description: '', expertise: ['tax'], traits: [], matchScore: 0.5, reasons: [], onRoster: false,
      }], true),
      'I need a skilled person for tax',
    );
    expect(hint).toBeNull();
  });

  it('builds soft hint when candidates exist below modal threshold', () => {
    const hint = buildCrewRosterHintFromEvaluation(
      evalWith([{
        id: 'a', origin: 'hub_catalog', callsign: 'aws_saa', name: 'Coach', title: 'AWS SAA Study Coach',
        description: '', expertise: ['AWS', 'SAA-C03'], traits: [], matchScore: 0.32, reasons: [], onRoster: false,
      }], false),
      'I need a skilled person for cloud architecture',
    );
    expect(hint).toContain('[CREW_ROSTER_HINT]');
    expect(hint).toContain('@aws_saa');
    expect(hint).toContain('ask_clarification');
  });

  it('tells Agent-X to proceed when workforce intent has no matches', () => {
    const hint = buildCrewRosterHintFromEvaluation(
      evalWith([], false),
      'I need to hire a specialist',
    );
    expect(hint).toContain('No Crew Hub specialists matched');
    expect(hint).toContain('Proceed as Agent-X');
  });
});
