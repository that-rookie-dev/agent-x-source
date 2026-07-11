import { generateId } from '@agentx/shared';
import type { EngineEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import { SubAgentManager } from './SubAgentManager.js';
import type { SubAgentTask } from './SubAgentManager.js';

export interface OrchestrationStep {
  id: string;
  description: string;
  instruction: string;
  tools: string[];
  dependsOn: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
}

export interface OrchestrationPlan {
  id: string;
  goal: string;
  steps: OrchestrationStep[];
  createdAt: number;
  status: 'planning' | 'executing' | 'completed' | 'failed';
}

export class AgentOrchestrator {
  private subAgents: SubAgentManager;
  private eventBus: AgentEventBus;
  private plans: Map<string, OrchestrationPlan> = new Map();

  constructor(subAgents: SubAgentManager, eventBus: AgentEventBus) {
    this.subAgents = subAgents;
    this.eventBus = eventBus;
  }

  /**
   * Create an orchestration plan from a high-level goal.
   * Uses an LLM call to decompose the goal into steps, or accepts an explicit plan.
   */
  async createPlan(goal: string): Promise<OrchestrationPlan> {
    const id = generateId('plan_');
    const plan: OrchestrationPlan = {
      id,
      goal,
      steps: [],
      createdAt: Date.now(),
      status: 'planning',
    };
    this.plans.set(id, plan);
    this.emit({ type: 'processing_start', taskDescription: `Planning: ${goal}` });
    return plan;
  }

  /**
   * Execute an orchestration plan — independent ready steps run in parallel
   * via SubAgentManager.spawnParallel (virtual concurrency pool).
   */
  async execute(planId: string): Promise<OrchestrationPlan> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    plan.status = 'executing';
    const startTime = Date.now();

    try {
      while (plan.steps.some((s) => s.status === 'pending')) {
        const ready = plan.steps.filter(
          (s) => s.status === 'pending' && this.depsSatisfied(plan, s),
        );

        if (ready.length === 0) {
          // Deadlock / failed deps — mark remaining pending as failed
          for (const s of plan.steps) {
            if (s.status === 'pending') {
              s.status = 'failed';
              s.result = 'Dependencies not satisfiable';
            }
          }
          break;
        }

        for (const step of ready) {
          step.status = 'running';
        }
        this.emit({
          type: 'processing_progress',
          stage: ready.map((s) => s.description).join(', '),
          progress: this.calculateProgress(plan),
        });

        // Fan-out: spawnParallel queues behind the concurrency semaphore
        const spawned = this.subAgents.spawnParallel(
          ready.map((s) => ({ instruction: s.instruction, tools: s.tools })),
          10,
        );

        await Promise.all(
          spawned.map(async (task, i) => {
            const step = ready[i]!;
            const result = await this.waitForSubAgent(task);
            step.result = result;
            step.status = task.status === 'completed' && result ? 'completed' : 'failed';
          }),
        );
      }

      plan.status = plan.steps.every((s) => s.status === 'completed') ? 'completed' : 'failed';
    } catch (error) {
      plan.status = 'failed';
      this.emit({
        type: 'error',
        code: 'ORCHESTRATION_FAILED',
        message: `Orchestration failed: ${(error as Error).message}`,
        recoverable: false,
      });
    }

    const elapsed = Date.now() - startTime;
    this.emit({
      type: 'task_consolidated_time',
      totalElapsed: elapsed,
      breakdown: plan.steps.map((s) => ({ tool: s.description, elapsed: 0 })),
    });

    return plan;
  }

  /**
   * Cancel a running orchestration plan.
   */
  cancel(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;
    plan.status = 'failed';
    this.subAgents.cancelAll();
  }

  /**
   * Get plan status.
   */
  getPlan(planId: string): OrchestrationPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * List all plans.
   */
  listPlans(): OrchestrationPlan[] {
    return [...this.plans.values()];
  }

  /**
   * Add a step to an existing plan.
   */
  addStep(planId: string, description: string, instruction: string, tools: string[], dependsOn: string[] = []): OrchestrationStep {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const step: OrchestrationStep = {
      id: generateId('step_'),
      description,
      instruction,
      tools,
      dependsOn,
      status: 'pending',
    };
    plan.steps.push(step);
    return step;
  }

  private depsSatisfied(plan: OrchestrationPlan, step: OrchestrationStep): boolean {
    for (const depId of step.dependsOn) {
      const dep = plan.steps.find((s) => s.id === depId);
      if (!dep) continue;
      if (dep.status === 'failed') return false;
      if (dep.status !== 'completed') return false;
    }
    return true;
  }

  private async waitForSubAgent(task: SubAgentTask): Promise<string> {
    const completed = await this.subAgents.waitFor(task.id);
    if (completed?.status === 'completed') return completed.result ?? '';
    return '';
  }

  private calculateProgress(plan: OrchestrationPlan): number {
    if (plan.steps.length === 0) return 0;
    const completed = plan.steps.filter((s) => s.status === 'completed' || s.status === 'failed').length;
    return completed / plan.steps.length;
  }

  private emit(event: EngineEvent): void {
    this.eventBus.emit(event);
  }
}
