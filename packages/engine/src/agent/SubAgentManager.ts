import type { EngineEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import { generateId } from '@agentx/shared';

export interface SubAgentTask {
  id: string;
  instruction: string;
  tools: string[];
  timeout: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  startTime?: number;
  endTime?: number;
}

export class SubAgentManager {
  private agents: Map<string, SubAgentTask> = new Map();
  private eventBus: AgentEventBus;

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  spawn(instruction: string, tools: string[], timeout = 30_000): SubAgentTask {
    const task: SubAgentTask = {
      id: generateId(),
      instruction,
      tools,
      timeout,
      status: 'pending',
    };

    this.agents.set(task.id, task);
    this.eventBus.emit({
      type: 'agent_spawned',
      agentId: task.id,
      task: instruction,
      startTime: Date.now(),
    } as EngineEvent);

    return task;
  }

  start(agentId: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'running';
      task.startTime = Date.now();
      this.eventBus.emit({
        type: 'agent_progress',
        agentId,
        status: 'running',
      } as EngineEvent);
    }
  }

  complete(agentId: string, result: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.endTime = Date.now();
      const elapsed = task.endTime - (task.startTime ?? task.endTime);
      this.eventBus.emit({
        type: 'agent_complete',
        agentId,
        summary: result,
        elapsed,
      } as EngineEvent);
    }
  }

  fail(agentId: string, error: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'failed';
      task.result = error;
      task.endTime = Date.now();
    }
  }

  cancel(agentId: string): void {
    const task = this.agents.get(agentId);
    if (task && (task.status === 'pending' || task.status === 'running')) {
      task.status = 'cancelled';
      task.endTime = Date.now();
    }
  }

  cancelAll(): void {
    for (const task of this.agents.values()) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'cancelled';
        task.endTime = Date.now();
      }
    }
  }

  getRunning(): SubAgentTask[] {
    return [...this.agents.values()].filter((t) => t.status === 'running');
  }

  getAll(): SubAgentTask[] {
    return [...this.agents.values()];
  }

  awaitAll(): Promise<SubAgentTask[]> {
    // In a real implementation, this would wait for all running agents
    // For now, return current state
    return Promise.resolve(this.getAll());
  }
}
