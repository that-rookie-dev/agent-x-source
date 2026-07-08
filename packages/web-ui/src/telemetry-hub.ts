import { connectSSE, type TelemetryEvent, type ConnectionState } from './api';

/**
 * Shared SSE hub — a single EventSource connection fanned out to all
 * subscribers. Previously AppContext and ChatPanel each opened their own
 * stream, doubling network traffic and JSON parsing for every telemetry event.
 */

type EventListener = (e: TelemetryEvent) => void;
type StateListener = (state: ConnectionState, info?: { retryIn?: number; attempt?: number }) => void;

const eventListeners = new Set<EventListener>();
const stateListeners = new Set<StateListener>();
let disconnect: (() => void) | null = null;
let lastState: ConnectionState = 'closed';

function ensureConnected(): void {
  if (disconnect) return;
  disconnect = connectSSE({
    onEvent: (e) => { for (const l of eventListeners) l(e); },
    onState: (state, info) => {
      lastState = state;
      for (const l of stateListeners) l(state, info);
    },
  });
}

export function subscribeTelemetry(onEvent: EventListener, onState?: StateListener): () => void {
  eventListeners.add(onEvent);
  if (onState) {
    stateListeners.add(onState);
    onState(lastState);
  }
  ensureConnected();
  return () => {
    eventListeners.delete(onEvent);
    if (onState) stateListeners.delete(onState);
    if (eventListeners.size === 0 && stateListeners.size === 0 && disconnect) {
      disconnect();
      disconnect = null;
      lastState = 'closed';
    }
  };
}
