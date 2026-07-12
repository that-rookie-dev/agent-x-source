import { describe, expect, it } from 'vitest';
import {
  buildResumeTurnInstructionFromMessages,
  resolveContinuationInstruction,
  isContinuationTrigger,
  detectIncompleteLastTurn,
} from '../src/utils/resume-turn.js';
import { mergeChannelLinkedMessages } from '../src/utils/channel-context-link.js';

describe('resume-turn', () => {
  it('builds resume block from prior user task and failed assistant reply', () => {
    const block = buildResumeTurnInstructionFromMessages([
      {
        role: 'user',
        content: 'Get me 22K gold rates in INR for Trivandrum, Bangalore, Chennai every morning at 11:45 AM.',
      },
      {
        role: 'assistant',
        content: 'I apologize, I was unable to generate a response.',
      },
    ]);

    expect(block).toContain('[RESUME — PRIOR REQUEST]');
    expect(block).toContain('22K gold rates');
    expect(block).toContain('unable to generate');
    expect(block).toContain('Do NOT ask them to repeat');
  });

  it('resolves continuation from persisted outstanding_task state', () => {
    const block = resolveContinuationInstruction({
      userText: 'Try now',
      messages: [],
      resumeState: {
        kind: 'outstanding_task',
        messageId: 'm1',
        userText: 'Get daily gold rates for Bangalore at 11:45 AM',
        lastFailure: 'I was unable to generate a response.',
        createdAt: new Date().toISOString(),
      },
    });

    expect(block).toContain('[RESUME — OUTSTANDING TASK]');
    expect(block).toContain('daily gold rates');
    expect(block).toContain('unable to generate');
  });

  it('treats short ok as continuation when prior turn failed', () => {
    const messages = [
      { role: 'user', content: 'Create a morning automation for gold prices in Chennai.' },
      { role: 'assistant', content: 'I was unable to generate a response.' },
    ];
    expect(detectIncompleteLastTurn(messages)?.userGoal).toContain('automation');
    const block = resolveContinuationInstruction({ userText: 'ok', messages });
    expect(block).toContain('automation');
  });

  it('returns null when no substantive prior user request exists', () => {
    expect(resolveContinuationInstruction({
      userText: 'try now',
      messages: [
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'try now' },
      ],
    })).toBeNull();
  });

  it('strips turn boundary markers from stored messages', () => {
    const block = buildResumeTurnInstructionFromMessages([
      {
        role: 'user',
        content: 'Schedule a daily digest at 9am\n[TURN turn-123 — treat prior messages as context only unless the user references them]',
      },
      { role: 'assistant', content: 'Something went wrong.' },
    ]);

    expect(block).toContain('Schedule a daily digest at 9am');
    expect(block).not.toContain('[TURN turn-123');
  });

  it('detects continuation triggers', () => {
    expect(isContinuationTrigger('Try now')).toBe(true);
    expect(isContinuationTrigger('can you try now')).toBe(true);
    expect(isContinuationTrigger('ok')).toBe(true);
    expect(isContinuationTrigger('Plan my trip to Japan')).toBe(false);
  });

  it('resumes after assistant re-asked which action to retry', () => {
    const messages = [
      {
        role: 'user',
        content: 'Get me 22K gold rates in INR for Trivandrum, Bangalore, Chennai every morning at 11:45 AM.',
      },
      {
        role: 'assistant',
        content: 'Siva, I can try now. Please tell me which action you would like me to retry.',
      },
    ];
    const block = resolveContinuationInstruction({ userText: 'can you try now', messages });
    expect(block).toContain('22K gold rates');
    expect(block).toContain('Do NOT ask them to repeat');
  });

  it('detects model refusal as incomplete turn', () => {
    const incomplete = detectIncompleteLastTurn([
      { role: 'user', content: 'Schedule daily gold rate updates at 11:45 AM for Chennai.' },
      { role: 'assistant', content: "I'm sorry, but I cannot assist with that request." },
    ]);
    expect(incomplete?.userGoal).toContain('gold rate');
    expect(incomplete?.assistantNote).toContain('cannot assist');
  });

  it('resolves try again using merged linked desktop + channel history', () => {
    const block = resolveContinuationInstruction({
      userText: 'try again',
      messages: mergeChannelLinkedMessages(
        [{ role: 'user', content: 'Set up gold rate automation daily at 9am for Bangalore.' }],
        [{ role: 'user', content: 'try again' }],
      ),
      resumeState: {
        kind: 'outstanding_task',
        messageId: 'm1',
        userText: 'Set up gold rate automation daily at 9am for Bangalore.',
        lastFailure: 'cannot assist',
        createdAt: new Date().toISOString(),
      },
    });
    expect(block).toContain('gold rate');
    expect(block).toContain('OUTSTANDING TASK');
  });
});
