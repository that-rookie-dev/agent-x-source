import { randomUUID } from 'node:crypto';
import type { QuestionnaireOption, QuestionnairePayload } from '@agentx/shared';
import { questionnaireSupportsInlineButtons } from '@agentx/shared';
import { QuestionnaireWizard } from './QuestionnaireWizard.js';

export interface QuestionnaireButton {
  label: string;
  actionId: string;
}

export interface QuestionnaireStepView {
  prompt: string;
  buttons: QuestionnaireButton[];
}

interface PendingSession {
  wizard: QuestionnaireWizard;
  userKey: string;
  selected: Set<number>;
}

/**
 * Multi-step choice questionnaire wizard for messaging channels (Telegram, Slack, Discord).
 */
export class MessagingQuestionnaireCoordinator {
  private pending = new Map<string, PendingSession>();

  start(payload: QuestionnairePayload, userKey: string): string | null {
    if (!questionnaireSupportsInlineButtons(payload)) return null;
    const token = randomUUID().slice(0, 8);
    this.pending.set(token, {
      wizard: new QuestionnaireWizard(payload),
      userKey,
      selected: new Set(),
    });
    return token;
  }

  getSession(token: string, userKey?: string): PendingSession | undefined {
    const session = this.pending.get(token);
    if (!session) return undefined;
    if (userKey && session.userKey !== userKey) return undefined;
    return session;
  }

  buildStepView(token: string): QuestionnaireStepView | null {
    const session = this.pending.get(token);
    if (!session) return null;
    const q = session.wizard.currentQuestion;
    if (!q || (q.type !== 'single_choice' && q.type !== 'multi_choice')) return null;

    const options = (q.options ?? []).filter((o) => !o.disabled);
    const header = session.wizard.totalQuestions > 1
      ? `*${session.wizard.currentIndex + 1}/${session.wizard.totalQuestions}* ${q.prompt}`
      : q.prompt;
    const prompt = q.type === 'multi_choice'
      ? `${header}\n\nTap to toggle, then Submit. Or type your answer.`
      : q.allowCustom !== false
        ? `${header}\n\n_Or type a custom answer._`
        : header;

    const buttons = this.buildChoiceButtons(options, token, q.type === 'multi_choice', session.selected);
    return { prompt, buttons };
  }

  private buildChoiceButtons(
    options: QuestionnaireOption[],
    token: string,
    multi: boolean,
    selected: Set<number>,
  ): QuestionnaireButton[] {
    const buttons: QuestionnaireButton[] = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const prefix = multi && selected.has(i) ? '✅ ' : !multi && opt.recommended ? '⭐ ' : '';
      buttons.push({
        label: `${prefix}${opt.label ?? opt.value}`.trim(),
        actionId: multi ? `clar:tog:${token}:${i}` : `clar:pick:${token}:${i}`,
      });
    }
    if (multi) {
      buttons.push({ label: '✓ Submit', actionId: `clar:sub:${token}` });
    }
    return buttons;
  }

  /**
   * Handle clar:* callback action. Returns formatted answer when the wizard completes.
   */
  handleCallback(data: string, userKey: string): string | null {
    const parts = data.split(':');
    if (parts[0] !== 'clar' || parts.length < 3) return null;
    const action = parts[1];
    const token = parts[2]!;
    const session = this.getSession(token, userKey);
    if (!session) return null;

    const q = session.wizard.currentQuestion;
    if (!q) return null;
    const options = (q.options ?? []).filter((o) => !o.disabled);

    if (action === 'pick' && parts[3] != null) {
      const idx = Number(parts[3]);
      if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) return null;
      session.wizard.recordSingleAnswer(options[idx]!.value);
      if (session.wizard.isComplete()) {
        const answer = session.wizard.formatFinalAnswer();
        this.pending.delete(token);
        return answer;
      }
      return '';
    }

    if (action === 'tog' && parts[3] != null) {
      const idx = Number(parts[3]);
      if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) return null;
      if (session.selected.has(idx)) session.selected.delete(idx);
      else session.selected.add(idx);
      return '';
    }

    if (action === 'sub') {
      if (session.selected.size === 0) return null;
      const values = [...session.selected].map((i) => options[i]!.value);
      session.wizard.recordMultiAnswer(new Set(values));
      if (session.wizard.isComplete()) {
        const answer = session.wizard.formatFinalAnswer();
        this.pending.delete(token);
        return answer;
      }
      return '';
    }

    return null;
  }

  clear(token: string): void {
    this.pending.delete(token);
  }

  clearForUser(userKey: string): void {
    for (const [token, session] of this.pending.entries()) {
      if (session.userKey === userKey) this.pending.delete(token);
    }
  }
}
