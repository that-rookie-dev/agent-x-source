import type { SessionStore } from './SessionStore.js';
import type { TaskPlan } from '../agent/TaskExecutor.js';

export interface TaskStore {
  save(plan: TaskPlan): Promise<void>;
  load(taskId: string): Promise<TaskPlan | null>;
  list(): Promise<TaskPlan[]>;
  delete(taskId: string): Promise<void>;
}

interface StoredEvent {
  type: string;
  payload: string;
  sessionId: string;
  sequence: number;
  created_at: string;
}

/**
 * TaskStore implementation backed by the session store's JSON event log.
 * Tasks are stored as structured JSON blobs in the session_events table,
 * keyed by a dedicated session ID for the task system.
 */
export class SessionTaskStore implements TaskStore {
  private sessionStore: SessionStore;
  private static readonly TASK_SESSION_ID = '__task_store__';

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  async save(plan: TaskPlan): Promise<void> {
    await this.sessionStore.insertSessionEvent({
      id: crypto.randomUUID(),
      sessionId: SessionTaskStore.TASK_SESSION_ID,
      sequence: Date.now(),
      type: 'task_plan',
      payload: JSON.stringify(plan),
      created_at: new Date().toISOString(),
    } as any);
  }

  async load(taskId: string): Promise<TaskPlan | null> {
    const events = await this.sessionStore.getSessionEvents(SessionTaskStore.TASK_SESSION_ID);
    const stored = events as unknown as StoredEvent[];
    for (let i = stored.length - 1; i >= 0; i--) {
      const ev = stored[i]!;
      if (ev.type === 'task_plan') {
        try {
          const parsed = JSON.parse(ev.payload) as TaskPlan;
          if (parsed.id === taskId) return parsed;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  async list(): Promise<TaskPlan[]> {
    const events = await this.sessionStore.getSessionEvents(SessionTaskStore.TASK_SESSION_ID);
    const stored = events as unknown as StoredEvent[];
    const plans: TaskPlan[] = [];
    const seen = new Set<string>();
    for (let i = stored.length - 1; i >= 0; i--) {
      const ev = stored[i]!;
      if (ev.type === 'task_plan') {
        try {
          const parsed = JSON.parse(ev.payload) as TaskPlan;
          if (!seen.has(parsed.id)) {
            seen.add(parsed.id);
            plans.push(parsed);
          }
        } catch {
          continue;
        }
      }
    }
    return plans;
  }

  async delete(taskId: string): Promise<void> {
    await this.sessionStore.insertSessionEvent({
      id: crypto.randomUUID(),
      sessionId: SessionTaskStore.TASK_SESSION_ID,
      sequence: Date.now(),
      type: 'task_deleted',
      payload: JSON.stringify({ taskId, deletedAt: new Date().toISOString() }),
      created_at: new Date().toISOString(),
    } as any);
  }
}
