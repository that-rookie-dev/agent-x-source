import { describe, it, expect } from 'vitest';
import { shouldAppendToAppContextEvents } from '../src/perf/telemetry-event-filter';

/**
 * Regression guard: panels that read AppContext.events must only depend on
 * event types whitelisted for global storage.
 */
describe('telemetry consumer regression', () => {
  const markdownPanelEvents = ['markdown_created'];
  const notificationsPanelEvents = ['notification_created'];
  const automationGlobalEvents = [
    'automation_run_triggered',
    'automation_run_preparing',
    'automation_run_started',
    'automation_run_ended',
  ];

  it('MarkdownPanel refresh events remain in AppContext', () => {
    for (const type of markdownPanelEvents) {
      expect(shouldAppendToAppContextEvents({ type })).toBe(true);
    }
  });

  it('NotificationsPanel refresh events remain in AppContext', () => {
    for (const type of notificationsPanelEvents) {
      expect(shouldAppendToAppContextEvents({ type })).toBe(true);
    }
  });

  it('Automation lifecycle sys events remain in AppContext', () => {
    for (const type of automationGlobalEvents) {
      expect(shouldAppendToAppContextEvents({ type })).toBe(true);
    }
  });

  it('chat stream events stay out of AppContext (handled by direct subscribers)', () => {
    const directSubscriberOnly = [
      'stream_chunk',
      'tool_executing',
      'tool_output',
      'loading_start',
      'message_received',
    ];
    for (const type of directSubscriberOnly) {
      expect(shouldAppendToAppContextEvents({ type })).toBe(false);
    }
  });
});
