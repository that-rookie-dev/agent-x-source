import { isBareContinueIntent } from './channel-integration-overlap.js';
import { collectAnsweredQuestionnaireTexts } from './questionnaire.js';
import type { SessionResumeState } from '../types/session-resume.js';

export type ResumeTurnMessage = {
  role?: string;
  content?: string;
  parts?: unknown;
};

const TURN_BOUNDARY_RE = /\n\[TURN [^\]]+\][^\n]*$/;
const FAILURE_RE = /\b(unable to generate|i apologize|i was unable|could not complete|something went wrong|failed to|provider error|encountered an error|cannot assist|tell me which|please tell me|what would you like me to retry|which action you)\b/i;

/** Short affirmations that mean "continue the last task" when work is outstanding. */
const CONTINUATION_AFFIRMATION_RE = /^\s*(?:yes(?:\s*please)?|yeah|yep|ok(?:ay)?|sure|sounds\s*good|please\s*proceed|please\s*continue|that'?s?\s*fine|fine|done|ready)\s*[.!?]?\s*$/i;

export function isContinuationTrigger(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return isBareContinueIntent(trimmed) || CONTINUATION_AFFIRMATION_RE.test(trimmed);
}

function messageText(message: ResumeTurnMessage): string {
  const raw = typeof message.content === 'string' ? message.content : '';
  return raw.replace(TURN_BOUNDARY_RE, '').trim();
}

function isSubstantiveUserRequest(text: string): boolean {
  if (!text || text.length < 12) return false;
  if (isContinuationTrigger(text)) return false;
  if (/^\[RETRY_LAST\]$/i.test(text)) return false;
  return true;
}

function looksLikeFailedAssistantTurn(text: string): boolean {
  if (!text) return false;
  if (FAILURE_RE.test(text)) return true;
  // Short non-answers (apologies, refusals, re-asks) signal an incomplete turn.
  return text.length > 0 && text.length < 200;
}

export function detectIncompleteLastTurn(messages: ResumeTurnMessage[]): {
  userGoal: string;
  assistantNote?: string;
} | null {
  let lastUserGoal: string | null = null;
  let lastAssistantFailure: string | null = null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message?.role) continue;

    if (message.role === 'assistant' && !lastAssistantFailure) {
      const text = messageText(message);
      if (looksLikeFailedAssistantTurn(text)) {
        lastAssistantFailure = text.slice(0, 280);
      }
    }

    if (message.role === 'user' && !lastUserGoal) {
      const text = messageText(message);
      if (isSubstantiveUserRequest(text)) {
        lastUserGoal = text;
      }
    }

    if (lastUserGoal && lastAssistantFailure) break;
  }

  if (!lastUserGoal || !lastAssistantFailure) return null;
  return { userGoal: lastUserGoal, assistantNote: lastAssistantFailure };
}

function findPendingQuestionnaire(messages: ResumeTurnMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant' || !Array.isArray(message.parts)) continue;
    for (const part of message.parts as Array<{ type?: string; questionnaire?: { status?: string } }>) {
      if (part.type === 'questionnaire' && part.questionnaire?.status === 'pending') {
        return true;
      }
    }
  }
  return false;
}

function isShortAmbiguousReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) return false;
  return !isSubstantiveUserRequest(trimmed);
}

function buildQuestionnaireFactsBlock(messages: ResumeTurnMessage[]): string | null {
  const answers = collectAnsweredQuestionnaireTexts(messages);
  if (answers.length === 0) return null;
  const facts = answers.slice(-12).map((a) => `- ${a}`);
  return [
    '[CONTINUE — SESSION CONTEXT]',
    'The user wants to continue. Do NOT restart discovery or re-ask answered questions.',
    'Synthesize what is already known and deliver the next concrete output.',
    'Established facts from this session:',
    ...facts,
    '[/CONTINUE — SESSION CONTEXT]',
  ].join('\n');
}

function buildOutstandingTaskBlock(state: SessionResumeState): string {
  return [
    '[RESUME — OUTSTANDING TASK]',
    'The user is continuing a task that did not finish on the prior turn. Do NOT ask them to repeat the request.',
    `Original request: ${state.userText ?? '(see conversation history)'}`,
    ...(state.lastFailure ? [`Prior attempt ended with: ${state.lastFailure}`] : []),
    'Complete the full solution now using tools as needed (web_search, automation_register, etc.).',
    '[/RESUME — OUTSTANDING TASK]',
  ].join('\n');
}

export function buildResumeTurnInstructionFromMessages(messages: ResumeTurnMessage[]): string | null {
  const incomplete = detectIncompleteLastTurn(messages);
  if (!incomplete) {
    let lastUserGoal: string | null = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role !== 'user') continue;
      const text = messageText(message);
      if (isSubstantiveUserRequest(text)) {
        lastUserGoal = text;
        break;
      }
    }
    if (!lastUserGoal) return null;
    return [
      '[RESUME — PRIOR REQUEST]',
      'The user sent a short retry/continue phrase. Do NOT ask them to repeat the task or restart discovery.',
      'Pick up the outstanding work from the prior turn and complete it now using tools as needed.',
      `Original request: ${lastUserGoal}`,
      'Deliver a concrete result (live data, automation_register for schedules, or a finished plan).',
      '[/RESUME — PRIOR REQUEST]',
    ].join('\n');
  }

  return [
    '[RESUME — PRIOR REQUEST]',
    'The user sent a short retry/continue phrase. Do NOT ask them to repeat the task or restart discovery.',
    'Pick up the outstanding work from the prior turn and complete it now using tools as needed.',
    `Original request: ${incomplete.userGoal}`,
    ...(incomplete.assistantNote ? [`Prior attempt ended with: ${incomplete.assistantNote}`] : []),
    'Deliver a concrete result (live data, automation_register for schedules, or a finished plan).',
    '[/RESUME — PRIOR REQUEST]',
  ].join('\n');
}

/**
 * Agent-core continuation resolver. Channels should stay thin — call this from Agent.sendMessage only.
 */
export function resolveContinuationInstruction(opts: {
  userText: string;
  messages: ResumeTurnMessage[];
  resumeState?: SessionResumeState | null;
}): string | null {
  const { userText, messages, resumeState } = opts;
  const trimmed = userText.trim();
  if (!trimmed) return null;

  const questionnaireFacts = buildQuestionnaireFactsBlock(messages);
  const hasPendingQuestionnaire = findPendingQuestionnaire(messages);
  const incomplete = detectIncompleteLastTurn(messages);
  const hasOutstandingState = resumeState?.kind === 'outstanding_task' && Boolean(resumeState.userText?.trim());
  const explicitTrigger = isContinuationTrigger(trimmed);
  const implicitTrigger = isShortAmbiguousReply(trimmed) && (Boolean(incomplete) || hasOutstandingState || hasPendingQuestionnaire);

  if (!explicitTrigger && !implicitTrigger) return null;

  if (hasOutstandingState && resumeState) {
    const blocks = [buildOutstandingTaskBlock(resumeState)];
    if (questionnaireFacts) blocks.push(questionnaireFacts);
    return blocks.join('\n\n');
  }

  if (questionnaireFacts && (explicitTrigger || hasPendingQuestionnaire)) {
    return questionnaireFacts;
  }

  return buildResumeTurnInstructionFromMessages(messages);
}
