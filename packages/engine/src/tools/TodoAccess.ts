import type { TodoManager } from '../agent/TodoManager.js';

const bySession = new Map<string, TodoManager>();

export function registerSessionTodoManager(sessionId: string, manager: TodoManager): void {
  bySession.set(sessionId, manager);
}

export function unregisterSessionTodoManager(sessionId: string): void {
  bySession.delete(sessionId);
}

export function getSessionTodoManager(sessionId: string): TodoManager | undefined {
  return bySession.get(sessionId);
}
