import { describe, it, expect } from 'vitest';
import {
  buildTurnContext,
  extractSessionIntent,
  needsContextMerge,
} from '../src/agent/TurnContextAssembler.js';

const VACATION_SESSION = [
  {
    role: 'user',
    content: 'I would like to plan for a vacation with my wife and 4 month old baby girl (first international trip). Beach and shopping. Help me prepare an itinerary',
  },
  {
    role: 'assistant',
    content: 'Hi, I am Elias. Before I dive into a full itinerary, I need to understand your situation better...',
  },
  {
    role: 'user',
    content: 'I am not sure, can you suggest me a best plan. This is kind of a surprise for my family.',
  },
  {
    role: 'assistant',
    content: 'Let me ask some clarifying questions about the surprise...',
  },
];

describe('TurnContextAssembler', () => {
  it('extracts session intent from the first substantive user message', () => {
    const intent = extractSessionIntent(VACATION_SESSION);
    expect(intent).toContain('vacation');
    expect(intent).toContain('4 month old');
  });

  it('merges intent when user defers planning', () => {
    const messages = [
      ...VACATION_SESSION,
      { role: 'user', content: 'plan it yourself' },
    ];
    expect(needsContextMerge('plan it yourself', messages.filter(m => m.role === 'user').map(m => m.content).slice(0, -1))).toBe(true);

    const ctx = buildTurnContext({
      messages,
      currentUserMessage: 'plan it yourself',
    });

    expect(ctx.needsContextMerge).toBe(true);
    expect(ctx.mergedTask).toContain('vacation');
    expect(ctx.mergedTask).toContain('plan it yourself');
    expect(ctx.block).toContain('Session intent');
    expect(ctx.block).toContain('follow-up or deferral');
  });

  it('does not merge standalone new requests', () => {
    const ctx = buildTurnContext({
      messages: [{ role: 'user', content: 'Help me refactor the auth module in src/auth.ts' }],
      currentUserMessage: 'Help me refactor the auth module in src/auth.ts',
    });
    expect(ctx.needsContextMerge).toBe(false);
    expect(ctx.mergedTask).toContain('auth module');
  });

  it('omits recent exchange when skipRecentExchange is set', () => {
    const ctx = buildTurnContext({
      messages: VACATION_SESSION,
      currentUserMessage: 'plan it yourself',
      skipRecentExchange: true,
    });
    expect(ctx.block).not.toContain('Recent exchange');
  });
});
