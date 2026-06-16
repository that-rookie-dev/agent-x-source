import type { EventBus, EngineEvent, EventHandler, SessionEvent } from '@agentx/shared';

export class AgentEventBus implements EventBus {
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
}
