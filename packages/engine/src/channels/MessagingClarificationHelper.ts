import type { Agent } from '../agent/Agent.js';
import type { EngineEvent, QuestionnairePayload } from '@agentx/shared';
import { extractAssistantReplyText, formatQuestionnaireForMessagingChannel } from '@agentx/shared';
import { MessagingQuestionnaireCoordinator } from './MessagingQuestionnaireCoordinator.js';

export interface MessagingClarificationHost {
  sendText: (text: string, threadTs?: string) => Promise<void>;
  sendQuestionnaireStep?: (prompt: string, buttons: Array<{ label: string; actionId: string }>, threadTs?: string) => Promise<void>;
  questionnaireCoordinator?: MessagingQuestionnaireCoordinator;
  userKey: string;
  threadTs?: string;
}

/** Subscribe to clarification events while a turn is in flight. */
export function attachMessagingClarificationListener(
  agent: Agent,
  host: MessagingClarificationHost,
): () => void {
  const coordinator = host.questionnaireCoordinator ?? new MessagingQuestionnaireCoordinator();

  return agent.events.on((event: EngineEvent) => {
    if (event.type === 'clarification_required') {
      void (async () => {
        const token = coordinator.start(event.questionnaire, host.userKey);
        if (token && host.sendQuestionnaireStep) {
          const view = coordinator.buildStepView(token);
          if (view) {
            await host.sendQuestionnaireStep(view.prompt, view.buttons, host.threadTs);
            return;
          }
        }
        const text = formatQuestionnaireForMessagingChannel(event.questionnaire);
        if (text) await host.sendText(text, host.threadTs);
      })();
      return;
    }

    if (event.type === 'message_received' && agent.isAwaitingClarification()) {
      const msg = event.message;
      const hasQuestionnaire = Array.isArray(msg.parts)
        && msg.parts.some((p) => (p as { type?: string }).type === 'questionnaire');
      const text = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!hasQuestionnaire && text) {
        void host.sendText(text, host.threadTs);
      }
    }
  });
}

export async function sendQuestionnaireStepForToken(
  coordinator: MessagingQuestionnaireCoordinator,
  token: string,
  host: Pick<MessagingClarificationHost, 'sendQuestionnaireStep' | 'sendText' | 'threadTs'>,
): Promise<void> {
  const view = coordinator.buildStepView(token);
  if (!view) return;
  if (host.sendQuestionnaireStep) {
    await host.sendQuestionnaireStep(view.prompt, view.buttons, host.threadTs);
  } else {
    await host.sendText(view.prompt, host.threadTs);
  }
}

export function tryConsumeMessagingClarification(
  agent: Agent | undefined,
  text: string,
): boolean {
  if (!agent?.isAwaitingClarification()) return false;
  return agent.respondToClarification(text);
}

export function extractMessagingReplyText(response: { content?: string; parts?: unknown }): string {
  return extractAssistantReplyText(response) || '(No response)';
}

export async function deliverQuestionnaireCallback(
  coordinator: MessagingQuestionnaireCoordinator,
  data: string,
  userKey: string,
  agent: Agent | undefined,
  host: Pick<MessagingClarificationHost, 'sendQuestionnaireStep' | 'sendText' | 'threadTs'>,
): Promise<boolean> {
  const result = coordinator.handleCallback(data, userKey);
  if (result === null) return false;
  if (result === '') {
    const token = data.split(':')[2];
    if (token) await sendQuestionnaireStepForToken(coordinator, token, host);
    return true;
  }
  if (result && agent?.respondToClarification(result)) return true;
  return false;
}

export type { QuestionnairePayload };
