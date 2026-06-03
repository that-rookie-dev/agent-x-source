type Handler<T = unknown> = (data: T) => void;

class MessageBus {
  private handlers = new Map<string, Set<Handler>>();

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as { type: string; data: unknown };
      if (!message || !message.type) return;

      const handlers = this.handlers.get(message.type);
      if (handlers) {
        for (const handler of handlers) {
          handler(message.data);
        }
      }
    });
  }

  on<T = unknown>(type: string, handler: Handler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as Handler);

    return () => {
      this.handlers.get(type)?.delete(handler as Handler);
    };
  }

  off(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit(type: string, data: unknown): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }
}

export const messageBus = new MessageBus();
