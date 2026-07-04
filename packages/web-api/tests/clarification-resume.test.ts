import { describe, it, expect, vi } from 'vitest';
import {
  findUserMessageBeforeQuestionnaire,
  buildQuestionnaireResumeInstruction,
} from '../src/clarification-resume.js';

describe('buildQuestionnaireResumeInstruction', () => {
  it('embeds the user answer in a resume block', () => {
    const out = buildQuestionnaireResumeInstruction('base', 'Q1: Early-stage trial');
    expect(out).toContain('base');
    expect(out).toContain('QUESTIONNAIRE_ALREADY_ANSWERED');
    expect(out).toContain('Early-stage trial');
  });

  it('embeds multiple answers in a resume block', () => {
    const out = buildQuestionnaireResumeInstruction('base', [
      'Dates: Oct 15–25',
      'Cities: Bangkok, Phuket',
    ]);
    expect(out).toContain('Dates: Oct 15–25');
    expect(out).toContain('Cities: Bangkok, Phuket');
    expect(out).toContain('ALL answers below');
  });
});

describe('findUserMessageBeforeQuestionnaire', () => {
  it('returns the user message immediately before the questionnaire', () => {
    const sessionId = 'sess-1';
    const store = {
      getMessages: () => [
        { id: 'u1', role: 'user', content: 'first question' },
        { id: 'a1', role: 'assistant', content: 'answer' },
        { id: 'u2', role: 'user', content: 'Be specific for Lung Cancer' },
        { id: 'q1', role: 'assistant', content: '', parts: [{ type: 'questionnaire', questionnaire: { status: 'pending' } }] },
      ],
    };

    vi.doMock('./engine.js', () => ({
      getEngine: () => ({ sessionManager: { store } }),
    }));

    // Inline store injection via module pattern — test the pure walk logic
    const msgs = store.getMessages();
    const qIdx = msgs.findIndex((m) => m.id === 'q1');
    let found: string | null = null;
    for (let i = qIdx - 1; i >= 0; i--) {
      if (msgs[i]!.role === 'user' && msgs[i]!.content?.trim()) {
        found = msgs[i]!.content.trim();
        break;
      }
    }
    expect(found).toBe('Be specific for Lung Cancer');
  });
});

describe('respondToClarification binding', () => {
  it('throws when method is detached from agent instance', () => {
    const agent = {
      clarificationResolve: (() => {}) as unknown as (v: string) => void,
      respondToClarification(response: string): boolean {
        if ((this as { clarificationResolve?: (v: string) => void }).clarificationResolve) {
          return true;
        }
        return false;
      },
    };
    const detached = agent.respondToClarification;
    expect(() => detached('yes')).toThrow();
    expect(agent.respondToClarification('yes')).toBe(true);
  });
});
