import type { CrewSuggestionEvaluation } from '@agentx/shared/browser';
import type { UIMessage } from './types';

export function shouldOfferCrewRosterPicker(evaluation: CrewSuggestionEvaluation): boolean {
  return evaluation.candidates.length > 0;
}

export function createCrewSuggestionEvalMessage(): UIMessage {
  const toolId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    streaming: false,
    parts: [{
      type: 'tool',
      id: toolId,
      tool: {
        id: toolId,
        name: 'crew_suggestion',
        status: 'running',
        args: { phase: 'matching' },
      },
    }],
  };
}
