import type { ConnectionState, TelemetryEvent } from '../api';
import { subscribeTelemetry } from '../telemetry-hub';
import { RenderScheduler } from './render-scheduler';

type EventListener = (e: TelemetryEvent) => void;
type StateListener = (state: ConnectionState, info?: { retryIn?: number; attempt?: number }) => void;

const schedulers = new WeakMap<EventListener, RenderScheduler>();

/**
 * Telemetry subscription with frame-budget coalescing. Drop-in replacement for
 * subscribeTelemetry in hot paths (ChatPanel).
 */
export function subscribeOptimizedTelemetry(
  onEvent: EventListener,
  onState?: StateListener,
): () => void {
  let scheduler = schedulers.get(onEvent);
  if (!scheduler) {
    scheduler = new RenderScheduler(onEvent);
    schedulers.set(onEvent, scheduler);
  }

  const wrapped: EventListener = (ev) => scheduler!.enqueue(ev);
  const disconnect = subscribeTelemetry(wrapped, onState);

  return () => {
    scheduler?.flushPending();
    schedulers.delete(onEvent);
    disconnect();
  };
}
