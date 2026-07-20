import { describe, it, expect } from 'vitest';
import { shouldAppendToAppContextEvents, isChatHotTelemetryEvent } from '../src/perf/telemetry-event-filter';

describe('telemetry-event-filter', () => {
  it('keeps global events in AppContext', () => {
    expect(shouldAppendToAppContextEvents({ type: 'notification_created' })).toBe(true);
    expect(shouldAppendToAppContextEvents({ type: 'markdown_created' })).toBe(true);
  });

  it('keeps automation lifecycle events in AppContext', () => {
    expect(shouldAppendToAppContextEvents({ type: 'automation_run_triggered' })).toBe(true);
    expect(shouldAppendToAppContextEvents({ type: 'automation_run_preparing' })).toBe(true);
  });

  it('filters chat hot events from AppContext', () => {
    expect(shouldAppendToAppContextEvents({ type: 'stream_chunk' })).toBe(false);
    expect(shouldAppendToAppContextEvents({ type: 'tool_output' })).toBe(false);
    expect(isChatHotTelemetryEvent({ type: 'turn_heartbeat' })).toBe(true);
  });
});
