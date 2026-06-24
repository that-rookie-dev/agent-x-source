import { describe, it, expect } from 'vitest';
import { DefaultTelemetryBus } from '../src/telemetry/TelemetryBus.js';

describe('DefaultTelemetryBus replay buffer', () => {
  it('does not replay crew_suggestion events to late subscribers', () => {
    const bus = new DefaultTelemetryBus({ enabled: true });
    bus.start();

    bus.emit({ type: 'crew_suggestion', timestamp: new Date().toISOString() } as never);
    bus.emit({ type: 'message_received', timestamp: new Date().toISOString() } as never);

    const received: string[] = [];
    bus.onEvent((ev) => {
      received.push(String((ev as { type?: string }).type));
    });

    expect(received).toEqual(['message_received']);
    expect(received).not.toContain('crew_suggestion');
  });
});
