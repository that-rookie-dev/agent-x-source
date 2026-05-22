import type { EventBus, EngineEvent, EventHandler } from '@agentx/shared';

export class AgentEventBus implements EventBus {
  private handlers: Set<EventHandler> = new Set();

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
}
