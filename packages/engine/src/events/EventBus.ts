import type { EventBus as IEventBus, EngineEvent, EventHandler, SessionEvent } from '@agentx/shared';

export type { IEventBus as EventBus, IEventBus, EngineEvent, EventHandler, SessionEvent };

/**
 * In-memory event bus implementing the shared EventBus contract.
 *
 * Can be swapped for a Redis-backed implementation later without changing
 * consumers because they depend on the shared EventBus interface.
 */
export class AgentEventBus implements IEventBus {
  private handlers: Set<EventHandler> = new Set();
  private sessionEventHandlers: Set<(event: SessionEvent) => void> = new Set();

  emit(event: EngineEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  once(handler: EventHandler): () => void {
    const wrapper: EventHandler = (event) => {
      this.handlers.delete(wrapper);
      handler(event);
    };
    this.handlers.add(wrapper);
    return () => this.handlers.delete(wrapper);
  }

  off(handler: EventHandler): void {
    this.handlers.delete(handler);
  }

  emitSessionEvent(event: SessionEvent): void {
    for (const handler of this.sessionEventHandlers) {
      handler(event);
    }
  }

  onSessionEvent(handler: (event: SessionEvent) => void): () => void {
    this.sessionEventHandlers.add(handler);
    return () => this.sessionEventHandlers.delete(handler);
  }

  offSessionEvent(handler: (event: SessionEvent) => void): void {
    this.sessionEventHandlers.delete(handler);
  }

  destroy(): void {
    this.handlers.clear();
    this.sessionEventHandlers.clear();
  }
}

/**
 * Factory for creating a new in-memory event bus.
 */
export function createEventBus(): IEventBus {
  return new AgentEventBus();
}
