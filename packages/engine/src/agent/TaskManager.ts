import type { EngineEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskContext {
  id: string;
  name: string;
  status: TaskStatus;
  startTime: number;
  endTime?: number;
  isForeground: boolean;
  tokenBudget: number;
  tokensUsed: number;
  result?: string;
}

export class TaskManager {
  private tasks: Map<string, TaskContext> = new Map();
  private eventBus: AgentEventBus;
  private foregroundTaskId: string | null = null;

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  createTask(id: string, name: string, tokenBudget: number): TaskContext {
    const task: TaskContext = {
      id,
      name,
      status: 'running',
      startTime: Date.now(),
      isForeground: this.foregroundTaskId === null,
      tokenBudget,
      tokensUsed: 0,
    };

    this.tasks.set(id, task);
    if (task.isForeground) {
      this.foregroundTaskId = id;
    }

    return task;
  }

  backgroundTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.isForeground) {
      task.isForeground = false;
      this.foregroundTaskId = null;
      this.eventBus.emit({ type: 'task_backgrounded', taskId } as EngineEvent);
    }
  }

  completeTask(taskId: string, result?: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.endTime = Date.now();
      task.result = result;

      if (task.isForeground) {
        this.foregroundTaskId = null;
      } else {
        this.eventBus.emit({
          type: 'background_task_complete',
          taskId,
          summary: result ?? 'Task completed',
        } as EngineEvent);
      }
    }
  }

  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'cancelled';
      task.endTime = Date.now();
      if (task.isForeground) {
        this.foregroundTaskId = null;
      }
    }
  }

  getForegroundTask(): TaskContext | null {
    return this.foregroundTaskId ? this.tasks.get(this.foregroundTaskId) ?? null : null;
  }

  getBackgroundTasks(): TaskContext[] {
    return [...this.tasks.values()].filter((t) => !t.isForeground && t.status === 'running');
  }

  getAllTasks(): TaskContext[] {
    return [...this.tasks.values()];
  }

  getRunningTasks(): TaskContext[] {
    return [...this.tasks.values()].filter((t) => t.status === 'running');
  }

  updateTokenUsage(taskId: string, tokens: number): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.tokensUsed += tokens;
    }
  }
}
