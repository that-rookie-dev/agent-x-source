import type { CrewMatchCandidate, CrewSuggestionEvaluation } from '@agentx/shared';
import { explicitCrewRequest, prefersCrewRosterFirst } from '@agentx/shared';
import { getCrewSuggestionService } from './get-crew-store.js';
import type { CrewKeywordExpandFn } from './crew-keyword-expander.js';

export interface CrewRosterHintInput {
  message: string;
  sessionId: string;
  store: unknown;
  priorUserMessages?: string[];
  /** User skipped/dismissed the crew suggestion modal — do not re-prompt. */
  crewSuggestionResolved?: boolean;
  /** User explicitly requested crew evaluation for this turn via the toggle. */
  crewSuggestionRequested?: boolean;
  expandKeywords?: CrewKeywordExpandFn;
}

function formatCandidateLine(c: CrewMatchCandidate, index: number): string {
  const pct = Math.round((c.matchScore ?? 0) * 100);
  const exp = [...new Set(c.expertise ?? [])].slice(0, 5).join(', ') || 'general';
  const roster = c.onRoster ? 'on roster' : 'hub catalog';
  return `${index + 1}. @${c.callsign} (${c.name}, ${c.title}) — ${pct}% match, ${roster} — ${exp}`;
}

export function buildCrewRosterHintFromEvaluation(
  evaluation: CrewSuggestionEvaluation,
  message: string,
): string | null {
  const workforce = prefersCrewRosterFirst(message);

  if (evaluation.candidates.length === 0) {
    if (!workforce) return null;
    return [
      '[CREW_ROSTER_HINT]',
      'No Crew Hub specialists matched this workforce/skills request.',
      'Proceed as Agent-X — answer the user directly (plans, guidance, or hiring advice as appropriate).',
      '[/CREW_ROSTER_HINT]',
    ].join('\n');
  }

  // High-confidence matches use the in-chat roster picker — agent should not duplicate unless user skipped.
  if (evaluation.shouldSuggest) return null;

  const lines = evaluation.candidates.slice(0, 5).map(formatCandidateLine);
  return [
    '[CREW_ROSTER_HINT]',
    'Possible Crew Hub specialists for this turn (popup did not trigger — offer in conversation first):',
    ...lines,
    '',
    'How to offer (pick one):',
    '- ask_clarification single_choice: top matches + "Continue with Agent-X" (max 5 options).',
    '- Brief inline @mention of 1–2 best fits, then ask if they want to recruit or continue with you.',
    '- search_crew_hub if you need a refined query.',
    '',
    'If the user declines or none fit, proceed as Agent-X — do not block on crew selection.',
    '[/CREW_ROSTER_HINT]',
  ].join('\n');
}

/** Evaluate catalog + roster and return a turn instruction block, or null. */
export async function buildCrewRosterHintBlock(input: CrewRosterHintInput): Promise<string | null> {
  if (input.crewSuggestionResolved) return null;
  // Skip evaluation entirely when the user hasn't requested suggestions and there's no explicit crew request.
  if (!input.crewSuggestionRequested && !explicitCrewRequest(input.message) && !prefersCrewRosterFirst(input.message)) return null;

  const service = getCrewSuggestionService(input.store);
  if (!service) return null;

  const evaluation = await service.evaluate({
    message: input.message,
    sessionId: input.sessionId,
    priorUserMessages: input.priorUserMessages,
    explicitCrewRequest: explicitCrewRequest(input.message),
    expandKeywords: input.expandKeywords,
  });

  // When the user explicitly requested a suggestion, always emit a hint block
  // (even with zero candidates) so the agent acknowledges the request.
  if (input.crewSuggestionRequested) {
    return buildCrewRosterHintFromEvaluation(evaluation, input.message)
      ?? [
        '[CREW_ROSTER_HINT]',
        'User requested crew suggestions for this turn, but no Crew Hub specialists matched.',
        'Proceed as Agent-X and offer general guidance; mention they can refine via @mentions or search_crew_hub.',
        '[/CREW_ROSTER_HINT]',
      ].join('\n');
  }

  if (!prefersCrewRosterFirst(input.message) && evaluation.candidates.length === 0) {
    return null;
  }

  return buildCrewRosterHintFromEvaluation(evaluation, input.message);
}
