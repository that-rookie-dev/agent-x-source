import { describe, it, expect } from 'vitest';
import {
  isTurnFeedbackEligible,
  summarizeTurnForFeedback,
  buildTurnFeedbackContext,
} from '../src/utils/turn-feedback.js';
import type { TurnFeedbackRecord } from '../src/types/turn-feedback.js';

describe('turn feedback utils', () => {
  it('rejects trivial assistant replies', () => {
    expect(isTurnFeedbackEligible({
      role: 'assistant',
      content: 'ok',
      streaming: false,
    })).toBe(false);
  });

  it('accepts substantive assistant replies', () => {
    expect(isTurnFeedbackEligible({
      role: 'assistant',
      content: 'I updated the Dockerfile and rebuilt the image. The service is now listening on port 8080 with health checks passing.',
      streaming: false,
    })).toBe(true);
  });

  it('accepts tool-heavy short replies', () => {
    expect(isTurnFeedbackEligible({
      role: 'assistant',
      content: 'Done.',
      toolCalls: [{ id: '1' }],
      streaming: false,
    })).toBe(true);
  });

  it('rejects pending questionnaires', () => {
    expect(isTurnFeedbackEligible({
      role: 'assistant',
      content: 'Please answer:',
      parts: [{ type: 'questionnaire', questionnaire: { status: 'pending' } }],
      streaming: false,
    })).toBe(false);
  });

  it('summarizes long content', () => {
    const long = 'a'.repeat(200);
    const summary = summarizeTurnForFeedback(long, 50);
    expect(summary.length).toBeLessThanOrEqual(50);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('builds prompt context from ratings', () => {
    const entries: TurnFeedbackRecord[] = [
      {
        id: '1',
        sessionId: 's1',
        messageId: 'm1',
        contextKind: 'agent_x',
        rating: 'negative',
        turnSummary: 'Plan was too shallow',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: '2',
        sessionId: 's1',
        messageId: 'm2',
        contextKind: 'agent_x',
        rating: 'positive',
        turnSummary: 'Good code changes',
        createdAt: '2026-01-03T00:00:00.000Z',
      },
    ];
    const block = buildTurnFeedbackContext(entries);
    expect(block).toContain('[USER_FEEDBACK]');
    expect(block).toContain('Plan was too shallow');
    expect(block).toContain('Good code changes');
  });
});
