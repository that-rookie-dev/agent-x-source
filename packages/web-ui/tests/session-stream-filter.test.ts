import { describe, expect, it } from 'vitest';
import { eventBelongsToViewSession, resolveTelemetryEventSessionId } from '../src/chat/session-stream-filter';

describe('session stream filter', () => {
  it('resolves session id from top-level or nested message', () => {
    expect(resolveTelemetryEventSessionId({ type: 'stream_chunk', sessionId: 'sess_a' })).toBe('sess_a');
    expect(resolveTelemetryEventSessionId({
      type: 'message_received',
      message: { sessionId: 'sess_b' },
    })).toBe('sess_b');
  });

  it('accepts events for the open session', () => {
    expect(eventBelongsToViewSession({ type: 'stream_chunk', sessionId: 'sess_a' }, 'sess_a')).toBe(true);
  });

  it('rejects events from another session (e.g. Telegram channel)', () => {
    expect(eventBelongsToViewSession({ type: 'stream_chunk', sessionId: 'telegram_sess' }, 'desktop_sess')).toBe(false);
    expect(eventBelongsToViewSession({ type: 'message_received', sessionId: 'telegram_sess', message: { sessionId: 'telegram_sess' } }, 'desktop_sess')).toBe(false);
    expect(eventBelongsToViewSession({ type: 'tool_executing', sessionId: 'telegram_sess', tool: 'x' }, 'desktop_sess')).toBe(false);
  });

  it('rejects scoped events when no chat session is open', () => {
    expect(eventBelongsToViewSession({ type: 'stream_chunk', sessionId: 'sess_a' }, null)).toBe(false);
  });

  it('accepts child session events for the parent view', () => {
    expect(eventBelongsToViewSession({
      type: 'child_session_started',
      sessionId: 'parent',
      parentSessionId: 'parent',
      childSessionId: 'child',
    }, 'parent')).toBe(true);
  });

  it('allows session-agnostic events such as crew suggestions', () => {
    expect(eventBelongsToViewSession({ type: 'crew_suggestion' }, 'sess_a')).toBe(true);
  });

  it('allows session-agnostic automation lifecycle events', () => {
    expect(eventBelongsToViewSession({ type: 'automation_run_triggered' }, 'sess_a')).toBe(true);
    expect(eventBelongsToViewSession({ type: 'automation_run_preparing' }, 'sess_a')).toBe(true);
  });
});
