import type { Crew, AgentXConfig } from '@agentx/shared';
import { generateId } from '@agentx/shared';
import type { Agent } from './Agent.js';
import { SmartSubAgent } from './SmartSubAgent.js';
import type { CrewMissionContext } from './CrewMissionContext.js';
import { buildCrewWorkerSystemPrompt, resolveCrewToolIds } from './crew-tools.js';
import type { AgentEventBus } from '../EventBus.js';
import type { EngineEvent } from '@agentx/shared';
import { registerWorker } from './crew-mission-registry.js';
import { outputNeedsClarification } from './crew-output-classifier.js';
import { checkCrewElapsedQuota } from './crew-mission-limits.js';

export interface CrewWorkerOptions {
  parentAgent: Agent;
  crew: Crew;
  task: string;
  missionContext: CrewMissionContext;
  eventBus: AgentEventBus;
  timeout?: number;
  planMode?: boolean;
  missionId?: string;
}

export interface CrewWorkerResult {
  workerId: string;
  crewId: string;
  crewName: string;
  callsign: string;
  success: boolean;
  output: string;
  elapsed: number;
  needsClarification?: boolean;
}

export class CrewWorker {
  readonly workerId: string;
  private opts: CrewWorkerOptions;

  constructor(opts: CrewWorkerOptions) {
    this.opts = opts;
    this.workerId = `crew-worker-${opts.crew.id}-${generateId().slice(0, 8)}`;
  }

  async execute(): Promise<CrewWorkerResult> {
    const { parentAgent, crew, task, missionContext, eventBus } = this.opts;
    const start = Date.now();
    const planMode = this.opts.planMode ?? (parentAgent as unknown as { planModeEnabled?: boolean }).planModeEnabled ?? false;

    registerWorker(this.workerId, this.opts.missionId ?? missionContext.missionId);

    eventBus.emit({
      type: 'crew_worker_spawned',
      workerId: this.workerId,
      crewId: crew.id,
      crewName: crew.name,
      callsign: crew.callsign,
      task: task.slice(0, 200),
    } as any);

    eventBus.emit({
      type: 'crew_worker_progress',
      workerId: this.workerId,
      crewId: crew.id,
      status: 'running',
      message: `${crew.name} started work`,
    } as any);

    const sharedContext = missionContext.getSharedContextBlock();
    const systemPrompt = buildCrewWorkerSystemPrompt(crew, sharedContext, planMode);
    const toolIds = resolveCrewToolIds(crew, planMode);

    let configOverride: Partial<AgentXConfig> | undefined;
    if (crew.model) {
      const parentConfig = (parentAgent as unknown as { config: AgentXConfig }).config;
      configOverride = {
        provider: {
          ...parentConfig.provider,
          activeProvider: crew.model.provider as AgentXConfig['provider']['activeProvider'],
          activeModel: crew.model.modelId,
        },
      };
    }

    const instruction = `${sharedContext ? `${sharedContext}\n\n` : ''}[YOUR TASK]\n${task}`;

    const sub = new SmartSubAgent({
      parentAgent,
      instruction,
      tools: toolIds,
      timeout: this.opts.timeout ?? 300_000,
      config: configOverride,
      sessionId: this.workerId,
      systemPromptOverride: systemPrompt,
      displayName: crew.name,
      childSessionKind: 'crew_worker',
      planMode,
      crewPermissions: crew.permissions ?? [],
      missionContext,
    });

    const parentEvents = (parentAgent as unknown as { events: AgentEventBus }).events;
    const unsubProgress = parentEvents.on((event: EngineEvent) => {
      if (event.type !== 'subagent_event') return;
      const subEv = event as { subagentId?: string; parentEvent?: { type?: string; tool?: string; description?: string } };
      if (subEv.subagentId !== this.workerId) return;
      const pe = subEv.parentEvent;
      if (!pe) return;
      if (pe.type === 'tool_executing') {
        const tool = pe.tool ?? 'tool';
        const desc = pe.description ? ` — ${String(pe.description).slice(0, 72)}` : '';
        eventBus.emit({
          type: 'crew_worker_progress',
          workerId: this.workerId,
          crewId: crew.id,
          status: 'running',
          message: `${tool}${desc}`,
        } as never);
      }
      if (pe.type === 'loading_step_update') {
        const label = (pe as { label?: string }).label;
        if (label) {
          eventBus.emit({
            type: 'crew_worker_progress',
            workerId: this.workerId,
            crewId: crew.id,
            status: 'running',
            message: label.slice(0, 100),
          } as never);
        }
      }
    });

    let result;
    try {
      // Share parent virtual-concurrency pool so crew workers don't stampede
      result = await parentAgent.agents.runInPool(() => sub.execute());
    } finally {
      unsubProgress();
    }
    const elapsed = Date.now() - start;
    const quotaError = checkCrewElapsedQuota(crew, elapsed);
    const needsClarification = !quotaError && outputNeedsClarification(result.output);
    const success = result.success && !quotaError && !needsClarification;
    const output = quotaError ? `[Quota exceeded: ${quotaError}]` : result.output;

    missionContext.addArtifact({
      workerId: this.workerId,
      crewId: crew.id,
      crewName: crew.name,
      callsign: crew.callsign,
      type: success ? 'output' : (needsClarification ? 'question' : 'blocker'),
      content: output.slice(0, 4000),
    });

    eventBus.emit({
      type: 'crew_worker_progress',
      workerId: this.workerId,
      crewId: crew.id,
      status: success ? 'done' : (needsClarification ? 'blocked' : 'error'),
      message: success ? 'Task completed' : output.slice(0, 120),
    } as any);

    eventBus.emit({
      type: 'crew_worker_complete',
      workerId: this.workerId,
      crewId: crew.id,
      crewName: crew.name,
      callsign: crew.callsign,
      success,
      output: output.slice(0, 8000),
      elapsed,
    } as any);

    return {
      workerId: this.workerId,
      crewId: crew.id,
      crewName: crew.name,
      callsign: crew.callsign,
      success,
      output,
      elapsed,
      needsClarification,
    };
  }
}
