import type { SessionResumeState } from '@agentx/shared';
import { getEngine } from './engine.js';

type ResumeStore = {
  setSessionResumeState?: (sessionId: string, state: {
    kind: string;
    messageId: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }) => void;
  getSessionResumeState?: (sessionId: string) => Record<string, unknown> | null;
  clearSessionResumeState?: (sessionId: string) => void;
};

export function getResumeStore(): ResumeStore | null {
  const eng = getEngine();
  return (eng.sessionManager as unknown as { store?: ResumeStore })?.store ?? null;
}

export function saveSessionResumeState(sessionId: string, state: SessionResumeState): void {
  const store = getResumeStore();
  store?.setSessionResumeState?.(sessionId, {
    kind: state.kind,
    messageId: state.messageId,
    payload: {
      questionnaireMessageId: state.questionnaireMessageId,
      userText: state.userText,
      lastFailure: state.lastFailure,
      delegateCrewIds: state.delegateCrewIds,
      primaryCrewId: state.primaryCrewId,
      crewIntakeFromPicker: state.crewIntakeFromPicker,
    },
    createdAt: state.createdAt,
  });
}

export function loadSessionResumeState(sessionId: string): SessionResumeState | null {
  const store = getResumeStore();
  const row = store?.getSessionResumeState?.(sessionId);
  if (!row) return null;
  let payload: Record<string, unknown> = {};
  const raw = row['payload'];
  if (typeof raw === 'string' && raw) {
    try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { payload = {}; }
  } else if (raw && typeof raw === 'object') {
    payload = raw as Record<string, unknown>;
  }
  return {
    kind: (row['kind'] ?? 'questionnaire') as SessionResumeState['kind'],
    messageId: String(row['message_id'] ?? row['messageId'] ?? ''),
    questionnaireMessageId: payload.questionnaireMessageId as string | undefined,
    userText: payload.userText as string | undefined,
    lastFailure: payload.lastFailure as string | undefined,
    delegateCrewIds: payload.delegateCrewIds as string[] | undefined,
    primaryCrewId: payload.primaryCrewId as string | undefined,
    crewIntakeFromPicker: payload.crewIntakeFromPicker as boolean | undefined,
    createdAt: String(row['created_at'] ?? row['createdAt'] ?? new Date().toISOString()),
  };
}

export function clearSessionResumeState(sessionId: string): void {
  getResumeStore()?.clearSessionResumeState?.(sessionId);
}
