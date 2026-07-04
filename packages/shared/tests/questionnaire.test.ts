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

  it('supports legacy single question + options', () => {
    const payload = normalizeAskClarificationArgs({
      question: 'Which framework?',
      options: ['React', 'Vue'],
    });
    expect(payload.questions[0]?.type).toBe('single_choice');
    expect(payload.questions[0]?.prompt).toBe('Which framework?');
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
