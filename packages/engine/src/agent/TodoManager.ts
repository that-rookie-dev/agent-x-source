import type { TodoItem, EngineEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';

export class TodoManager {
  private items: TodoItem[] = [];
  private eventBus: AgentEventBus;
  private nextId = 1;

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  addItem(title: string): TodoItem {
    const item: TodoItem = {
      id: this.nextId++,
      title,
      status: 'not-started',
    };
    this.items.push(item);
    this.emitUpdate();
    return item;
  }

  addItems(titles: string[]): TodoItem[] {
    return titles.map((title) => this.addItem(title));
  }

  startItem(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      // Only one in-progress at a time
      for (const other of this.items) {
        if (other.status === 'in-progress') {
          other.status = 'not-started';
        }
      }
      item.status = 'in-progress';
      this.emitUpdate();
    }
  }

  completeItem(id: number): void {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.status = 'completed';
      this.emitUpdate();
    }
  }

  updateItem(id: number, updates: { title?: string; status?: TodoItem['status'] }): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    if (updates.title !== undefined) item.title = updates.title;
    if (updates.status !== undefined) {
      if (updates.status === 'in-progress') {
        for (const other of this.items) {
          if (other.status === 'in-progress' && other.id !== id) other.status = 'not-started';
        }
      }
      item.status = updates.status;
    }
    this.emitUpdate();
    return true;
  }

  deleteItem(id: number): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    this.emitUpdate();
    return true;
  }

  getItems(): TodoItem[] {
    return [...this.items];
  }

  getProgress(): { completed: number; total: number; current: string | null } {
    const completed = this.items.filter((i) => i.status === 'completed').length;
    const current = this.items.find((i) => i.status === 'in-progress');
    return {
      completed,
      total: this.items.length,
      current: current?.title ?? null,
    };
  }

  clear(): void {
    this.items = [];
    this.nextId = 1;
    this.emitUpdate();
  }

  private emitUpdate(): void {
    this.eventBus.emit({ type: 'todo_update', items: [...this.items] } as EngineEvent);
  }
}
