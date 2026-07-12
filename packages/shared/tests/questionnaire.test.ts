import { describe, it, expect } from 'vitest';
import {
  normalizeAskClarificationArgs,
  legacyClarificationToQuestionnaire,
  formatQuestionnaireAnswers,
  initialQuestionnaireState,
  canSubmitQuestionnaire,
  MAX_QUESTIONNAIRE_CHOICES,
  collectAnsweredQuestionnaireTexts,
  hydrateMessageHistoryEntries,
  sanitizeQuestionnairePayload,
  formatQuestionnaireForMessagingChannel,
  extractAssistantReplyText,
  isTextOnlyClarification,
  shouldUseQuestionnaireClarification,
  TEXT_CLARIFICATION_REJECTED_MESSAGE,
  isMessagingChannel,
  questionnaireHasChoices,
  questionnaireSupportsInlineButtons,
  MESSAGING_INLINE_MAX_OPTIONS,
  MESSAGING_INLINE_MAX_QUESTIONS,
} from '../src/utils/questionnaire.js';

describe('normalizeAskClarificationArgs', () => {
  it('builds multi-question questionnaire', () => {
    const payload = normalizeAskClarificationArgs({
      title: 'Trip details',
      questions: [
        { prompt: 'Where are you flying from?', type: 'text' },
        { prompt: 'Cabin class?', type: 'single_choice', options: ['Economy', 'Business'] },
      ],
    });
    expect(payload.questions).toHaveLength(2);
    expect(payload.title).toBe('Trip details');
  });

  it('caps choice options at five', () => {
    const payload = normalizeAskClarificationArgs({
      questions: [{
        prompt: 'Pick one',
        type: 'single_choice',
        options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      }],
    });
    expect(payload.questions[0]?.options).toHaveLength(MAX_QUESTIONNAIRE_CHOICES);
  });

  it('coerces object-shaped options from model tool args', () => {
    const payload = normalizeAskClarificationArgs({
      questions: [{
        prompt: 'How to proceed?',
        type: 'single_choice',
        options: [
          { label: 'Run it manually now' },
          { value: 'Save a briefing script' },
          { label: { label: 'Just retry later' } } as unknown as string,
          'Both: run now + save script',
        ],
      }],
    });
    const opts = payload.questions[0]?.options ?? [];
    expect(opts.map((o) => o.value)).toEqual([
      'Run it manually now',
      'Save a briefing script',
      'Just retry later',
      'Both: run now + save script',
    ]);
    expect(opts.every((o) => typeof o.label === 'string')).toBe(true);
  });

  it('sanitizes already-persisted nested label objects', () => {
    const cleaned = sanitizeQuestionnairePayload({
      id: 'q',
      questions: [{
        id: 'q_1',
        prompt: 'Pick',
        type: 'single_choice',
        options: [
          { value: { label: 'A' } as unknown as string, label: { label: 'A' } as unknown as string },
          { value: { label: 'B' } as unknown as string, label: { label: 'B' } as unknown as string },
        ],
      }],
    });
    expect(cleaned.questions[0]?.options).toEqual([
      { value: 'A', label: 'A', recommended: false },
      { value: 'B', label: 'B', recommended: false },
    ]);
  });
});

describe('formatQuestionnaireAnswers', () => {
  it('formats multiple answers', () => {
    const payload = legacyClarificationToQuestionnaire({ question: 'ignored' });
    payload.questions = [
      { id: 'a', prompt: 'Name?', type: 'text', required: true },
      { id: 'b', prompt: 'Color?', type: 'single_choice', required: true, options: [{ value: 'Blue', label: 'Blue' }] },
    ];
    const state = initialQuestionnaireState(payload);
    state.a = 'Alex';
    state.b = 'Blue';
    expect(formatQuestionnaireAnswers(payload, state)).toBe('Name?: Alex\nColor?: Blue');
    expect(canSubmitQuestionnaire(payload, state)).toBe(true);
  });

  it('prefers custom answer on single choice', () => {
    const payload = normalizeAskClarificationArgs({
      question: 'Pick',
      options: ['A', 'B'],
    });
    const state = initialQuestionnaireState(payload);
    state.choices = 'A';
    state['choices__custom'] = 'Something else';
    expect(formatQuestionnaireAnswers(payload, state)).toBe('Pick: Something else');
  });
});

describe('collectAnsweredQuestionnaireTexts', () => {
  it('collects answered questionnaire parts in order', () => {
    const messages = [
      { role: 'user', content: 'Plan a trip' },
      {
        role: 'assistant',
        content: '',
        parts: [{ type: 'questionnaire', questionnaire: { status: 'answered', answer: 'Dates: Oct 15–25' } }],
      },
      {
        role: 'assistant',
        content: '',
        parts: [{ type: 'questionnaire', questionnaire: { status: 'answered', answer: 'Style: Beach' } }],
      },
    ];
    expect(collectAnsweredQuestionnaireTexts(messages)).toEqual(['Dates: Oct 15–25', 'Style: Beach']);
  });
});

describe('hydrateMessageHistoryEntries', () => {
  it('injects questionnaire answers as user history entries', () => {
    const entries = hydrateMessageHistoryEntries([
      { role: 'user', content: 'Plan a trip' },
      {
        role: 'assistant',
        content: '',
        parts: [{ type: 'questionnaire', questionnaire: { status: 'answered', answer: 'Dates: Oct 15–25' } }],
      },
    ]);
    expect(entries).toEqual([
      { role: 'user', content: 'Plan a trip' },
      { role: 'user', content: 'Dates: Oct 15–25' },
    ]);
  });
});

describe('messaging channel questionnaire helpers', () => {
  it('detects messaging channels', () => {
    expect(isMessagingChannel('telegram')).toBe(true);
    expect(isMessagingChannel('slack')).toBe(true);
    expect(isMessagingChannel('api')).toBe(false);
  });

  it('formats choice questionnaire for messaging', () => {
    const payload = normalizeAskClarificationArgs({
      questions: [{
        prompt: 'Which framework?',
        type: 'single_choice',
        options: ['React', 'Vue'],
        recommended: 'React',
      }],
    });
    expect(questionnaireHasChoices(payload)).toBe(true);
    expect(isTextOnlyClarification(payload)).toBe(false);
    const text = formatQuestionnaireForMessagingChannel(payload);
    expect(text).toContain('Which framework?');
    expect(text).toContain('1. React *(suggested)*');
    expect(text).toContain('2. Vue');
  });

  it('detects text-only clarifications', () => {
    const textOnly = normalizeAskClarificationArgs({
      questions: [{ prompt: 'What dates?', type: 'text' }],
    });
    expect(isTextOnlyClarification(textOnly)).toBe(true);
    expect(shouldUseQuestionnaireClarification(textOnly)).toBe(false);

    const choice = normalizeAskClarificationArgs({
      questions: [{ prompt: 'Pick', type: 'single_choice', options: ['A', 'B'] }],
    });
    expect(shouldUseQuestionnaireClarification(choice)).toBe(true);
  });

  it('extractAssistantReplyText prefers content then questionnaire parts', () => {
    const withContent = extractAssistantReplyText({ content: 'Hello there' });
    expect(withContent).toBe('Hello there');

    const payload = normalizeAskClarificationArgs({
      question: 'Pick one',
      options: ['A', 'B'],
    });
    const fromParts = extractAssistantReplyText({
      content: '',
      parts: [{ type: 'questionnaire', questionnaire: { payload } }],
    });
    expect(fromParts).toContain('Pick one');
    expect(fromParts).toContain('1. A');
  });

  it('questionnaireSupportsInlineButtons allows simple choice wizards', () => {
    const ok = normalizeAskClarificationArgs({
      questions: [
        { prompt: 'Channel?', type: 'single_choice', options: ['Telegram', 'Slack', 'Discord'] },
        { prompt: 'Frequency?', type: 'single_choice', options: ['Daily', 'Weekly'] },
      ],
    });
    expect(questionnaireSupportsInlineButtons(ok)).toBe(true);
  });

  it('questionnaireSupportsInlineButtons rejects too many options or mixed types', () => {
    const tooManyOptions: import('../src/types/questionnaire.js').QuestionnairePayload = {
      id: 'q',
      questions: [{
        id: 'q1',
        prompt: 'Pick',
        type: 'single_choice',
        options: Array.from({ length: MESSAGING_INLINE_MAX_OPTIONS + 1 }, (_, i) => ({
          value: `opt${i}`,
          label: `opt${i}`,
        })),
      }],
    };
    expect(questionnaireSupportsInlineButtons(tooManyOptions)).toBe(false);

    const mixed = normalizeAskClarificationArgs({
      questions: [
        { prompt: 'Name?', type: 'text' },
        { prompt: 'Channel?', type: 'single_choice', options: ['A', 'B'] },
      ],
    });
    expect(questionnaireSupportsInlineButtons(mixed)).toBe(false);

    const tooManyQuestions = normalizeAskClarificationArgs({
      questions: Array.from({ length: MESSAGING_INLINE_MAX_QUESTIONS + 1 }, (_, i) => ({
        prompt: `Q${i}`,
        type: 'single_choice' as const,
        options: ['A', 'B'],
      })),
    });
    expect(questionnaireSupportsInlineButtons(tooManyQuestions)).toBe(false);
  });
});
