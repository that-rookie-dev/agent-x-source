import type { SubAgentTask } from './SubAgentManager.js';

export interface SubAgentRecord extends SubAgentTask {
  parentSessionId?: string;
  childSessionId?: string;
  background?: boolean;
  consumed?: boolean;
}

/**
 * Global registry for sub-agent tasks across all Agent instances.
 *
 * The SubAgentManager is bound to a single Agent and its event bus, so it
 * loses visibility when a session is closed or the user navigates. This
 * service persists task metadata and results in memory, allowing background
 * sub-agents to outlive the Agent that spawned them and report back when
 * the session is resumed.
 */
export class SubAgentService {
  private tasks = new Map<string, SubAgentRecord>();

  registerTask(task: SubAgentRecord): void {
    this.tasks.set(task.id, { ...task });
  }

  updateTask(id: string, patch: Partial<SubAgentRecord>): void {
    const existing = this.tasks.get(id);
    if (existing) {
      this.tasks.set(id, { ...existing, ...patch });
    }
  }

  getTask(id: string): SubAgentRecord | undefined {
    return this.tasks.get(id);
  }

  listTasks(): SubAgentRecord[] {
    return [...this.tasks.values()];
  }

  getTasksForSession(sessionId: string): SubAgentRecord[] {
    return this.listTasks().filter((t) => t.parentSessionId === sessionId);
  }

  getRunningTasksForSession(sessionId: string): SubAgentRecord[] {
    return this.getTasksForSession(sessionId).filter(
      (t) => t.status === 'pending' || t.status === 'running' || t.status === 'queued',
    );
  }

  getCompletedTasksForSession(sessionId: string): SubAgentRecord[] {
    return this.getTasksForSession(sessionId).filter((t) => t.status === 'completed');
  }

  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === 'pending' || task.status === 'running' || task.status === 'queued') {
      this.tasks.set(id, { ...task, status: 'cancelled', endTime: Date.now() });
      return true;
    }
    return false;
  }

  deleteTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  /**
   * Return completed background results for a session that have not yet been
   * consumed by the parent. The caller is responsible for consuming them with
   * `consumeResults` once they are injected into the parent's history.
   */
  getUnconsumedResults(sessionId: string): SubAgentRecord[] {
    return this.getTasksForSession(sessionId).filter(
      (t) => t.background && t.status === 'completed' && !t.consumed,
    );
  }

  consumeResults(sessionId: string): SubAgentRecord[] {
    const results = this.getUnconsumedResults(sessionId);
    for (const task of results) {
      this.tasks.set(task.id, { ...task, consumed: true });
    }
    return results;
  }

  clear(): void {
    this.tasks.clear();
  }
}

let subAgentServiceInstance: SubAgentService | null = null;

export function getSubAgentServiceInstance(): SubAgentService {
  if (!subAgentServiceInstance) {
    subAgentServiceInstance = new SubAgentService();
  }
  return subAgentServiceInstance;
}

export function setSubAgentServiceInstance(service: SubAgentService | null): void {
  subAgentServiceInstance = service;
}
