import { describe, it, expect } from 'vitest';
import { createAiSdkStreamHandler } from '../src/agent/AiSdkStreamHandler.js';
import type { EngineEvent } from '@agentx/shared';

/**
 * Regression tests for the message-concatenation bug documented in
 * docs/engineering-crew/DESIGN.md Section 2.6: when a continuation/retry stream
 * is fed into the same handler without calling reset(), the continuation's text
 * gets silently glued onto the prior response, producing a concatenated duplicate
 * message. The fix is to call streamHandler.reset() before consuming any
 * continuation/retry stream (see Agent.ts lines ~3524, ~3615, ~3675, ~3747, ~3938).
 */
describe('AiSdkStreamHandler reset prevents message concatenation', () => {
  it('accumulates text within a single stream', () => {
    const events: EngineEvent[] = [];
    const handler = createAiSdkStreamHandler(
      (e) => { events.push(e); },
      'sess-1',
      () => {},
    );

    handler.handleEvent({ type: 'text-delta', text: 'First response part 1. ' });
    handler.handleEvent({ type: 'text-delta', text: 'Part 2.' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 10, outputTokens: 20 } });

    expect(handler.getState().accumulatedContent).toBe('First response part 1. Part 2.');
  });

  it('reset() clears accumulatedContent so a continuation does not concatenate', () => {
    const events: EngineEvent[] = [];
    const handler = createAiSdkStreamHandler(
      (e) => { events.push(e); },
      'sess-1',
      () => {},
    );

    // First stream produces a response
    handler.handleEvent({ type: 'text-delta', text: 'Original response.' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 10, outputTokens: 20 } });
    expect(handler.getState().accumulatedContent).toBe('Original response.');

    // Simulate the bug: feed a continuation WITHOUT reset()
    // (This is what the code used to do before the fix)
    handler.handleEvent({ type: 'text-delta', text: 'Continuation text.' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 5, outputTokens: 10 } });

    // Without reset, the content is concatenated — this demonstrates the bug
    expect(handler.getState().accumulatedContent).toBe('Original response.Continuation text.');
  });

  it('reset() before a continuation produces clean, non-concatenated content', () => {
    const events: EngineEvent[] = [];
    const handler = createAiSdkStreamHandler(
      (e) => { events.push(e); },
      'sess-1',
      () => {},
    );

    // First stream produces a response
    handler.handleEvent({ type: 'text-delta', text: 'Original response.' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 10, outputTokens: 20 } });
    const originalContent = handler.getState().accumulatedContent;
    expect(originalContent).toBe('Original response.');

    // Reset before the continuation (the fix)
    handler.reset();
    expect(handler.getState().accumulatedContent).toBe('');

    // Feed the continuation stream
    handler.handleEvent({ type: 'text-delta', text: 'Continuation text.' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 5, outputTokens: 10 } });

    // After reset, the handler only contains the continuation's text
    expect(handler.getState().accumulatedContent).toBe('Continuation text.');
    expect(handler.getState().accumulatedContent).not.toContain('Original response.');
  });

  it('reset() emits stream_clear so the UI replaces rather than appends', () => {
    const events: EngineEvent[] = [];
    const handler = createAiSdkStreamHandler(
      (e) => { events.push(e); },
      'sess-1',
      () => {},
    );

    handler.handleEvent({ type: 'text-delta', text: 'First.' });
    handler.handleEvent({ type: 'finish', usage: { inputTokens: 5, outputTokens: 5 } });

    // Clear events to isolate reset's emission
    events.length = 0;
    handler.reset();

    expect(events.some((e) => e.type === 'stream_clear')).toBe(true);
  });

  it('multiple reset() + continuation cycles do not accumulate stale content', () => {
    const handler = createAiSdkStreamHandler(
      () => {},
      'sess-1',
      () => {},
    );

    for (let i = 0; i < 3; i++) {
      handler.reset();
      handler.handleEvent({ type: 'text-delta', text: `Round ${i} text.` });
      handler.handleEvent({ type: 'finish', usage: { inputTokens: 1, outputTokens: 1 } });
    }

    // Should only contain the last round's text, not all three concatenated
    expect(handler.getState().accumulatedContent).toBe('Round 2 text.');
    expect(handler.getState().accumulatedContent).not.toContain('Round 0');
    expect(handler.getState().accumulatedContent).not.toContain('Round 1');
  });
});
