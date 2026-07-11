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

function isCrewSuggestionEvalPlaceholder(message: UIMessage): boolean {
  return message.role === 'assistant' && message.parts?.some(
    (part) => part.type === 'tool' && part.tool?.name === 'crew_suggestion',
  ) === true;
}

function hasPendingCrewRosterPicker(message: UIMessage, pendingUserText: string): boolean {
  return message.parts?.some(
    (part) => part.type === 'crew_roster_picker'
      && part.crewRosterPicker?.status === 'pending'
      && part.crewRosterPicker.pendingUserText === pendingUserText,
  ) === true;
}

/** Merge a single crew roster picker offer into chat state without duplicate user/picker bubbles. */
export function mergeCrewRosterPickerIntoMessages(
  prev: UIMessage[],
  trimmed: string,
  pickerMsg: UIMessage,
  persisted: { userMessageId: string; pickerMessageId: string },
  opts?: { userMessageId?: string; evalAssistantMessageId?: string },
  attachments?: Array<{ name: string }>,
): UIMessage[] {
  let next = prev.filter((message) => {
    if (message.id === opts?.evalAssistantMessageId) return false;
    if (isCrewSuggestionEvalPlaceholder(message)) return false;
    if (hasPendingCrewRosterPicker(message, trimmed) && message.id !== persisted.pickerMessageId) {
      return false;
    }
    return true;
  });

  const matchingUsers = next.filter((message) => message.role === 'user' && message.content === trimmed);
  const keepUserId = opts?.userMessageId && matchingUsers.some((message) => message.id === opts.userMessageId)
    ? opts.userMessageId
    : matchingUsers[0]?.id;

  next = next.filter((message) => {
    if (message.role === 'user' && message.content === trimmed && message.id !== keepUserId) return false;
    return true;
  });

  if (keepUserId) {
    next = next.map((message) => (
      message.id === keepUserId
        ? { ...message, id: persisted.userMessageId, content: trimmed }
        : message
    ));
  } else {
    next.push({
      id: persisted.userMessageId,
      role: 'user',
      content: trimmed,
      streaming: false,
      attachments: attachments ?? [],
    });
  }

  if (next.some((message) => message.id === persisted.pickerMessageId)) {
    return next.map((message) => (message.id === persisted.pickerMessageId ? pickerMsg : message));
  }
  return [...next, pickerMsg];
}
