import type { Agent } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getEngine } from './engine.js';
import {
  runAgentTurnAsync,
  applySessionModeToAgent,
  buildInstructionForMode,
  isCrewPrivateSessionRecord,
} from './chat-helpers.js';
import { turnRegistry } from './turn-registry.js';
import { loadSessionResumeState, clearSessionResumeState, saveSessionResumeState } from './session-resume-state.js';

type MessageStore = {
  getMessages?: (sessionId: string) => Array<Record<string, unknown>>;
  updateMessage?: (sessionId: string, messageId: string, patch: { parts?: Array<Record<string, unknown>> }) => void;
};

function getMessageStore(): MessageStore | null {
  const eng = getEngine();
  return (eng.sessionManager as unknown as { store?: MessageStore })?.store ?? null;
}

export function persistClarificationResumeFromAgent(agent: Agent, sessionId: string): void {
  const resume = (agent as unknown as {
    getClarificationResumeState?: () => {
      kind: 'questionnaire' | 'crew_intake';
      messageId: string;
      questionnaireMessageId?: string;
      userText?: string;
      delegateCrewIds?: string[];
      primaryCrewId?: string;
      crewIntakeFromPicker?: boolean;
      createdAt: string;
    } | null;
  }).getClarificationResumeState?.();
  if (resume) {
    saveSessionResumeState(sessionId, resume);
  }
}

function findPendingQuestionnaireMessage(sessionId: string): {
  messageId: string;
  part: Record<string, unknown>;
} | null {
  const store = getMessageStore();
  const msgs = store?.getMessages?.(sessionId) ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    const parts = msg['parts'] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts)) continue;
    const part = parts.find((p) =>
      p['type'] === 'questionnaire'
      && (p['questionnaire'] as { status?: string } | undefined)?.status === 'pending',
    );
    if (part) {
      return { messageId: String(msg['id'] ?? ''), part };
    }
  }
  return null;
}

function markQuestionnaireAnswered(
  sessionId: string,
  messageId: string,
  part: Record<string, unknown>,
  response: string,
): void {
  const store = getMessageStore();
  if (!store?.updateMessage) return;
  const questionnaire = part['questionnaire'] as Record<string, unknown>;
  const answered = {
    ...questionnaire,
    status: response === '(skipped)' ? 'skipped' : 'answered',
    answer: response,
    answeredAt: new Date().toISOString(),
  };
  store.updateMessage(sessionId, messageId, {
    parts: [{ ...part, questionnaire: answered }],
  });
}

export async function handleClarificationRespond(response: string): Promise<{
  ok: boolean;
  resumed?: boolean;
  error?: string;
  status?: number;
}> {
  const trimmed = response.trim();
  if (!trimmed) return { ok: false, error: 'empty-response', status: 400 };

  const eng = getEngine();
  const agent = eng.agent;
  if (!agent) return { ok: false, error: 'no-session', status: 400 };

  const sessionId = (agent as unknown as { sessionId: string }).sessionId;
  const respond = (agent as unknown as { respondToClarification: (r: string) => boolean }).respondToClarification;

  if (respond?.(trimmed)) {
    clearSessionResumeState(sessionId);
    return { ok: true, resumed: true };
  }

  const resume = loadSessionResumeState(sessionId);
  const pending = findPendingQuestionnaireMessage(sessionId);
  if (!resume && !pending) {
    return { ok: false, error: 'no-pending-clarification', status: 409 };
  }

  if (pending) {
    markQuestionnaireAnswered(sessionId, pending.messageId, pending.part, trimmed);
  }
  clearSessionResumeState(sessionId);
  (agent as unknown as { clearClarificationResumeState?: () => void }).clearClarificationResumeState?.();

  if (resume?.crewIntakeFromPicker && resume.delegateCrewIds?.length && resume.userText) {
    const mode = applySessionModeToAgent(agent);
    const activeSess = eng.sessionManager.getActiveSession?.();
    const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
    const instruction = buildInstructionForMode(mode, { crewPrivate: crewPrivateChat });
    const turn = turnRegistry.create(sessionId);
    runAgentTurnAsync(
      agent,
      resume.userText,
      instruction,
      false,
      turn.turnId,
      sessionId,
      undefined,
      undefined,
      resume.delegateCrewIds,
      true,
      false,
      resume.primaryCrewId,
      {
        resumeCrewIntake: {
          originalUserText: resume.userText,
          intakeAnswer: trimmed,
          delegateCrewIds: resume.delegateCrewIds,
          primaryCrewId: resume.primaryCrewId,
        },
      },
    );
    return { ok: true, resumed: true };
  }

  getLogger().info('CLARIFICATION_RESUME', `Answered restored questionnaire in session ${sessionId.slice(0, 8)}`);
  return { ok: true, resumed: false };
}
