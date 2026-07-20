import { describe, expect, it } from 'vitest';
import {
  createCrewSuggestionEvalMessage,
  mergeCrewRosterPickerIntoMessages,
  shouldOfferCrewRosterPicker,
} from '../src/chat/crew-suggestion-flow';
import type { CrewSuggestionEvaluation } from '@agentx/shared/browser';
import type { UIMessage } from '../src/chat/types';

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

describe('mergeCrewRosterPickerIntoMessages', () => {
  const trimmed = 'Plan a trip to Europe';
  const evaluation = evalWith(2);
  const persisted = {
    userMessageId: 'user-db',
    pickerMessageId: 'picker-db',
    pickerPartId: 'part-db',
  };
  const pickerMsg: UIMessage = {
    id: persisted.pickerMessageId,
    role: 'assistant',
    content: '',
    streaming: false,
    parts: [{
      type: 'crew_roster_picker',
      id: persisted.pickerPartId,
      crewRosterPicker: {
        id: persisted.pickerPartId,
        status: 'pending',
        evaluation,
        pendingUserText: trimmed,
      },
    }],
  };

  it('replaces eval placeholder with picker and normalizes user id', () => {
    const userMessageId = 'user-local';
    const evalAssistant = createCrewSuggestionEvalMessage();
    const prev: UIMessage[] = [
      { id: userMessageId, role: 'user', content: trimmed, streaming: false },
      evalAssistant,
    ];

    const next = mergeCrewRosterPickerIntoMessages(
      prev,
      trimmed,
      pickerMsg,
      persisted,
      { userMessageId, evalAssistantMessageId: evalAssistant.id },
    );

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: persisted.userMessageId, role: 'user', content: trimmed });
    expect(next[1]).toMatchObject({ id: persisted.pickerMessageId, role: 'assistant' });
    expect(next[1]?.parts?.[0]?.type).toBe('crew_roster_picker');
  });

  it('dedupes websocket-attached user and picker bubbles', () => {
    const userMessageId = 'user-local';
    const evalAssistant = createCrewSuggestionEvalMessage();
    const prev: UIMessage[] = [
      { id: userMessageId, role: 'user', content: trimmed, streaming: false },
      evalAssistant,
      { id: persisted.userMessageId, role: 'user', content: trimmed, streaming: false },
      pickerMsg,
    ];

    const next = mergeCrewRosterPickerIntoMessages(
      prev,
      trimmed,
      pickerMsg,
      persisted,
      { userMessageId, evalAssistantMessageId: evalAssistant.id },
    );

    expect(next).toHaveLength(2);
    expect(next.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(next.filter((message) => message.parts?.[0]?.type === 'crew_roster_picker')).toHaveLength(1);
  });
});
