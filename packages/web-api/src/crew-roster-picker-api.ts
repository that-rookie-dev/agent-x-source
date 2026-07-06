import { generateId } from '@agentx/shared';
import type { CrewMatchCandidate, CrewRosterPickerRecord, CrewSuggestionEvaluation } from '@agentx/shared';
import { getEngine } from './engine.js';

type MessageStore = {
  getMessages?: (sessionId: string) => Array<Record<string, unknown>>;
  insertMessage?: (msg: {
    id: string;
    sessionId: string;
    role: string;
    content: string;
    parts?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }) => string;
  updateMessage?: (sessionId: string, messageId: string, patch: {
    parts?: Array<Record<string, unknown>>;
  }) => void;
};

function getMessageStore(): MessageStore | null {
  const eng = getEngine();
  return (eng.sessionManager as unknown as { store?: MessageStore })?.store ?? null;
}

function findExistingPendingPicker(
  sessionId: string,
  userText: string,
): { userMessageId: string; pickerMessageId: string; pickerPartId: string } | null {
  const store = getMessageStore();
  const msgs = store?.getMessages?.(sessionId) ?? [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const msg = msgs[i]!;
    if (msg['role'] !== 'assistant') continue;
    const parts = msg['parts'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts)) continue;
    const part = parts.find((p) => p['type'] === 'crew_roster_picker');
    const record = part?.['crewRosterPicker'] as CrewRosterPickerRecord | undefined;
    if (!record || record.status !== 'pending' || record.pendingUserText !== userText) continue;
    const pickerMessageId = String(msg['id'] ?? '');
    const pickerPartId = String(part?.['id'] ?? record.id);
    let userMessageId = '';
    for (let j = i - 1; j >= 0; j -= 1) {
      const userMsg = msgs[j]!;
      if (userMsg['role'] === 'user' && userMsg['content'] === userText) {
        userMessageId = String(userMsg['id'] ?? '');
        break;
      }
    }
    if (!pickerMessageId || !pickerPartId) continue;
    return {
      userMessageId: userMessageId || generateId(),
      pickerMessageId,
      pickerPartId,
    };
  }
  return null;
}

export function persistCrewRosterPickerOffer(input: {
  sessionId: string;
  userText: string;
  evaluation: CrewSuggestionEvaluation;
  attachments?: Array<{ name: string }>;
  userMessageId?: string;
}): { userMessageId: string; pickerMessageId: string; pickerPartId: string } {
  const existing = findExistingPendingPicker(input.sessionId, input.userText);
  if (existing) return existing;

  const store = getMessageStore();
  const now = new Date().toISOString();
  const userMessageId = input.userMessageId ?? generateId();
  const pickerMessageId = generateId();
  const pickerPartId = generateId();

  const pickerRecord: CrewRosterPickerRecord = {
    id: pickerPartId,
    status: 'pending',
    evaluation: input.evaluation,
    pendingUserText: input.userText,
  };

  const parts = [{
    type: 'crew_roster_picker',
    id: pickerPartId,
    crewRosterPicker: pickerRecord,
  }];

  store?.insertMessage?.({
    id: userMessageId,
    sessionId: input.sessionId,
    role: 'user',
    content: input.userText,
    createdAt: now,
    ...(input.attachments?.length ? { metadata: { attachments: input.attachments } } : {}),
  });

  store?.insertMessage?.({
    id: pickerMessageId,
    sessionId: input.sessionId,
    role: 'assistant',
    content: '',
    parts,
    createdAt: now,
  });

  return { userMessageId, pickerMessageId, pickerPartId };
}

export function updateCrewRosterPickerStatus(input: {
  sessionId: string;
  pickerMessageId: string;
  status: 'answered' | 'skipped';
  selectedCandidateIds?: string[];
  evaluation: CrewSuggestionEvaluation;
  pendingUserText: string;
  pickerPartId?: string;
}): void {
  const store = getMessageStore();
  if (!store?.updateMessage) return;

  const partId = input.pickerPartId ?? generateId();
  const pickerRecord: CrewRosterPickerRecord = {
    id: partId,
    status: input.status,
    evaluation: input.evaluation,
    pendingUserText: input.pendingUserText,
    selectedCandidateIds: input.selectedCandidateIds,
  };

  store.updateMessage(input.sessionId, input.pickerMessageId, {
    parts: [{
      type: 'crew_roster_picker',
      id: partId,
      crewRosterPicker: pickerRecord,
    }],
  });
}

/** Map candidate id to deployed crew id (hub re-recruit may return roster id). */
export function mapPrimaryCrewId(
  primaryCandidateId: string | undefined,
  selected: CrewMatchCandidate[],
  deployedCrewIds: string[],
): string | undefined {
  if (!primaryCandidateId || deployedCrewIds.length === 0) return deployedCrewIds[0];
  const idx = selected.findIndex((c) => c.id === primaryCandidateId);
  if (idx >= 0 && deployedCrewIds[idx]) return deployedCrewIds[idx];
  const top = [...selected].sort((a, b) => b.matchScore - a.matchScore)[0];
  if (!top) return deployedCrewIds[0];
  const topIdx = selected.findIndex((c) => c.id === top.id);
  if (topIdx >= 0 && deployedCrewIds[topIdx]) return deployedCrewIds[topIdx];
  return deployedCrewIds[0];
}
