import type { Agent } from '@agentx/engine';
import { collectAnsweredQuestionnaireTexts, getLogger } from '@agentx/shared';
import { getEngine, createAgent, destroyAgent } from './engine.js';
import {
  runAgentTurnAsync,
  buildTurnInstruction,
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
  const resume = agent.getClarificationResumeState?.();
  if (resume) {
    saveSessionResumeState(sessionId, resume);
  }
}

export function findPendingQuestionnaireMessage(sessionId: string): {
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

/** User turn that triggered the pending questionnaire (walk backward from questionnaire msg). */
export function findUserMessageBeforeQuestionnaire(
  sessionId: string,
  questionnaireMessageId: string,
): string | null {
  const msgs = getMessageStore()?.getMessages?.(sessionId) ?? [];
  const qIdx = msgs.findIndex((m) => String(m['id'] ?? '') === questionnaireMessageId);
  if (qIdx < 0) return null;
  for (let i = qIdx - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    if (msg['role'] === 'user' && typeof msg['content'] === 'string' && msg['content'].trim()) {
      return msg['content'].trim();
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

export function buildQuestionnaireResumeInstruction(baseInstruction: string, answers: string | string[]): string {
  const answerBlock = (Array.isArray(answers) ? answers : [answers]).filter((a) => a.trim()).join('\n');
  return `${baseInstruction}

[QUESTIONNAIRE_ALREADY_ANSWERED]
The user submitted questionnaire answers (session may have reconnected or the prior turn timed out). Continue the original request using ALL answers below. Do not re-ask these questions — deliver the complete response or plan now.

${answerBlock}
[/QUESTIONNAIRE_ALREADY_ANSWERED]`;
}

export function collectSessionQuestionnaireAnswers(sessionId: string, includeAnswer?: string): string[] {
  const msgs = getMessageStore()?.getMessages?.(sessionId) ?? [];
  const answers = collectAnsweredQuestionnaireTexts(msgs);
  const extra = includeAnswer?.trim();
  if (extra && !answers.includes(extra)) {
    answers.push(extra);
  }
  return answers;
}

function agentSessionId(agent: Agent): string {
  return (agent as unknown as { sessionId: string }).sessionId;
}

function ensureAgentForSession(requestedSessionId?: string): {
  agent: Agent;
  sessionId: string;
} | {
  error: string;
  status: number;
} {
  const eng = getEngine();
  let agent = eng.agent;
  if (!agent) return { error: 'no-session', status: 400 };

  const targetSessionId = requestedSessionId ?? agentSessionId(agent);
  if (agentSessionId(agent) !== targetSessionId) {
    const session = eng.sessionManager.getSessionById(targetSessionId);
    if (!session) return { error: 'session-not-found', status: 404 };
    destroyAgent();
    eng.sessionManager.restoreSession(targetSessionId);
    createAgent(undefined, session);
    agent = eng.agent;
    if (!agent) return { error: 'no-session', status: 400 };
  }

  return { agent, sessionId: targetSessionId };
}

export async function handleClarificationRespond(
  response: string,
  requestedSessionId?: string,
): Promise<{
  ok: boolean;
  resumed?: boolean;
  error?: string;
  status?: number;
}> {
  const trimmed = response.trim();
  if (!trimmed) return { ok: false, error: 'empty-response', status: 400 };

  const ensured = ensureAgentForSession(requestedSessionId);
  if ('error' in ensured) {
    return { ok: false, error: ensured.error, status: ensured.status };
  }
  const { agent, sessionId } = ensured;

  // Must call on the agent instance — unbound extraction loses `this` and throws.
  if (agent.respondToClarification(trimmed)) {
    clearSessionResumeState(sessionId);
    return { ok: true, resumed: true };
  }

  const resume = loadSessionResumeState(sessionId);
  const pending = findPendingQuestionnaireMessage(sessionId);
  if (!resume && !pending) {
    return { ok: false, error: 'no-pending-clarification', status: 409 };
  }

  const questionnaireMessageId = pending?.messageId ?? resume?.questionnaireMessageId ?? resume?.messageId;
  if (pending) {
    markQuestionnaireAnswered(sessionId, pending.messageId, pending.part, trimmed);
  }
  clearSessionResumeState(sessionId);
  agent.clearClarificationResumeState?.();

  if (resume?.crewIntakeFromPicker && resume.delegateCrewIds?.length && resume.userText) {
    const activeSess = getEngine().sessionManager.getActiveSession?.()
      ?? getEngine().sessionManager.getSessionById(sessionId);
    const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
    const instruction = buildTurnInstruction({ crewPrivate: crewPrivateChat });
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

  const priorUserText = questionnaireMessageId
    ? findUserMessageBeforeQuestionnaire(sessionId, questionnaireMessageId)
    : null;

  if (priorUserText) {
    const activeSess = getEngine().sessionManager.getActiveSession?.()
      ?? getEngine().sessionManager.getSessionById(sessionId);
    const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
    const allAnswers = collectSessionQuestionnaireAnswers(sessionId, trimmed);
    const instruction = buildQuestionnaireResumeInstruction(
      buildTurnInstruction({ crewPrivate: crewPrivateChat }) ?? '',
      allAnswers.length > 0 ? allAnswers : trimmed,
    );
    const turn = turnRegistry.create(sessionId);
    runAgentTurnAsync(
      agent,
      priorUserText,
      instruction,
      true,
      turn.turnId,
      sessionId,
    );
    getLogger().info('CLARIFICATION_RESUME', `Resumed questionnaire turn in session ${sessionId.slice(0, 8)}`);
    return { ok: true, resumed: true };
  }

  getLogger().info('CLARIFICATION_RESUME', `Marked questionnaire answered in session ${sessionId.slice(0, 8)} (no turn to resume)`);
  return { ok: true, resumed: false };
}
