import { generateId } from '@agentx/shared';
import type { Agent } from './Agent.js';
import type { CrewMember, CrewOrchestrator } from './CrewOrchestrator.js';
import { CrewMissionContext } from './CrewMissionContext.js';
import { CrewWorker, type CrewWorkerResult } from './CrewWorker.js';
import type { AgentEventBus } from '../EventBus.js';
import { FiberSet } from '../concurrency/FiberSet.js';
import { decomposeCrewTasks, resolveMissionProtocol } from './crew-task-decomposition.js';
import { capMissionMembers } from './crew-mission-limits.js';
import {
  beginMissionSession,
  endMissionSession,
  registerMission,
  unregisterMission,
} from './crew-mission-registry.js';

import type { ClarificationRequestMeta } from '@agentx/shared';

export interface CrewMissionOptions {
  agent: Agent;
  members: CrewMember[];
  userMessage: string;
  sessionContext?: string;
  maxRetries?: number;
  planMode?: boolean;
  sessionId?: string;
  mainSystemPrompt?: string;
  crewOrchestrator?: CrewOrchestrator;
  waitForClarification?: (
    question: string,
    options?: string[],
    allowFreeform?: boolean,
    meta?: ClarificationRequestMeta,
  ) => Promise<string>;
  onMissionEvent?: (payload: Record<string, unknown>) => void;
}

export interface CrewMissionResult {
  missionId: string;
  success: boolean;
  workers: CrewWorkerResult[];
  synthesized: string;
  supervisorReview?: string;
  responses: Array<{ member: string; content: string; crewId: string; callsign: string }>;
}

export class CrewMissionOrchestrator {
  constructor(private eventBus: AgentEventBus) {}

  async runMission(opts: CrewMissionOptions): Promise<CrewMissionResult> {
    const missionId = generateId();
    const sessionId = opts.sessionId;
    if (!sessionId) {
      return {
        missionId,
        success: false,
        workers: [],
        synthesized: 'Crew mission requires a session ID.',
        responses: [],
      };
    }
    const maxRetries = opts.maxRetries ?? 3;
    const members = capMissionMembers(opts.members);

    if (members.length === 0) {
      return {
        missionId,
        success: false,
        workers: [],
        synthesized: 'No crew members available for this mission.',
        responses: [],
      };
    }

    if (!beginMissionSession(sessionId, missionId)) {
      return {
        missionId,
        success: false,
        workers: [],
        synthesized: 'A crew mission is already in progress for this session.',
        responses: [],
      };
    }

    const context = new CrewMissionContext(missionId, opts.userMessage);
    const taskMap = decomposeCrewTasks(opts.userMessage, members);
    const protocol = resolveMissionProtocol(members);
    const taskText = this.stripMentionTokens(opts.userMessage);

    registerMission({
      missionId,
      sessionId,
      context,
      members,
      eventBus: this.eventBus,
      interCrewDelegate: opts.crewOrchestrator
        ? (fromId, toId, message) =>
            opts.crewOrchestrator!.interCrewMessage(
              fromId,
              toId,
              message,
              opts.mainSystemPrompt ?? '',
              opts.planMode ?? false,
            )
        : undefined,
    });

    this.persist(opts, {
      type: 'crew_mission_snapshot',
      missionId,
      phase: 'start',
      snapshot: context.toSnapshot(),
    });

    this.eventBus.emit({
      type: 'crew_mission_start',
      missionId,
      crews: members.map((m) => m.crew.callsign),
      task: taskText.slice(0, 300),
    } as never);

    let workers: CrewWorkerResult[] = [];
    let attempt = 0;
    let missionSuccess = false;

    try {
      while (attempt < maxRetries) {
        attempt++;
        context.status = attempt > 1 ? 'retrying' : 'running';

        if (attempt > 1) {
          this.eventBus.emit({
            type: 'crew_mission_retry',
            missionId,
            attempt,
            maxRetries,
          } as never);
        }

        const membersToRun = attempt === 1
          ? members
          : members.filter((m) => {
              const prev = workers.find((w) => w.crewId === m.crew.id);
              return !prev?.success;
            });

        if (membersToRun.length === 0) break;

        let batch: CrewWorkerResult[];
        switch (protocol) {
          case 'sequential':
            batch = await this.runSequential(opts, membersToRun, taskMap, context, attempt);
            break;
          case 'debate':
            batch = await this.runDebate(opts, membersToRun, taskMap, context, attempt);
            break;
          case 'handoff':
            batch = await this.runHandoff(opts, membersToRun, taskMap, context, attempt);
            break;
          default:
            batch = await this.runParallel(opts, membersToRun, taskMap, context, attempt);
        }

        workers = this.mergeWorkerResults(workers, batch);

        const verification = this.verifyWorkers(workers);
        if (verification.passed) {
          missionSuccess = true;
          context.status = 'complete';
          break;
        }

        context.addRetryFeedback(
          `Attempt ${attempt} issues: ${verification.issues.join('; ')}`,
        );

        const blocked = workers.filter((w) => w.needsClarification);
        if (blocked.length > 0) {
          context.status = 'blocked';
          const clarified = await this.runClarificationRound(opts, blocked, context);
          if (!clarified) break;
        }
      }

      if (!missionSuccess) context.status = 'failed';

      const responses = workers.map((w) => ({
        member: w.crewName,
        content: w.output,
        crewId: w.crewId,
        callsign: w.callsign,
      }));

      const synthesized = await this.synthesizeResponses(
        opts,
        taskText,
        responses,
        missionSuccess,
      );

      this.eventBus.emit({
        type: 'crew_mission_complete',
        missionId,
        success: missionSuccess,
        synthesized: synthesized.slice(0, 500),
      } as never);

      this.persist(opts, {
        type: 'crew_mission_snapshot',
        missionId,
        phase: 'complete',
        success: missionSuccess,
        snapshot: context.toSnapshot(),
      });

      return { missionId, success: missionSuccess, workers, synthesized, responses };
    } finally {
      unregisterMission(missionId);
      endMissionSession(sessionId, missionId);
    }
  }

  private async runParallel(
    opts: CrewMissionOptions,
    members: CrewMember[],
    taskMap: Map<string, string>,
    context: CrewMissionContext,
    attempt: number,
  ): Promise<CrewWorkerResult[]> {
    const fiberSet = new FiberSet();
    for (const member of members) {
      const crewTask = this.buildCrewTask(member, taskMap, opts.sessionContext, context, attempt);
      fiberSet.run(`crew-worker-${member.crew.id}`, async () =>
        this.executeMemberWorker(opts, member, crewTask, context),
      );
    }
    return fiberSet.joinAll<CrewWorkerResult>();
  }

  private async runDebate(
    opts: CrewMissionOptions,
    members: CrewMember[],
    taskMap: Map<string, string>,
    context: CrewMissionContext,
    attempt: number,
  ): Promise<CrewWorkerResult[]> {
    if (members.length === 0) return [];

    this.eventBus.emit({
      type: 'crew_mission_phase',
      missionId: context.missionId,
      phase: 'debate_round_1',
    } as never);

    const round1 = await this.runParallel(opts, members, taskMap, context, attempt);
    for (const r of round1) {
      if (r.success) {
        context.addArtifact({
          workerId: r.workerId,
          crewId: r.crewId,
          crewName: r.crewName,
          callsign: r.callsign,
          type: 'output',
          content: `[Debate round 1 @${r.callsign}]: ${r.output.slice(0, 1500)}`,
        });
      }
    }

    if (members.length < 2) return round1;

    this.eventBus.emit({
      type: 'crew_mission_phase',
      missionId: context.missionId,
      phase: 'debate_round_2',
    } as never);

    const fiberSet = new FiberSet();
    for (const member of members) {
      const others = round1.filter((r) => r.crewId !== member.crew.id);
      const peerSummary = others
        .map((r) => `[${r.crewName}]:\n${r.output.slice(0, 1200)}`)
        .join('\n\n---\n\n');
      const critiqueTask = [
        this.buildCrewTask(member, taskMap, opts.sessionContext, context, attempt),
        '',
        '[DEBATE ROUND 2 — critique peers and refine your position]',
        `Review these responses from other crew members:\n\n${peerSummary}`,
        'Provide your critique, resolve conflicts, and deliver your refined final answer.',
      ].join('\n');

      fiberSet.run(`crew-debate-r2-${member.crew.id}`, async () =>
        this.executeMemberWorker(opts, member, critiqueTask, context),
      );
    }

    const round2 = await fiberSet.joinAll<CrewWorkerResult>();
    return round2.length > 0 ? round2 : round1;
  }

  private async runHandoff(
    opts: CrewMissionOptions,
    members: CrewMember[],
    taskMap: Map<string, string>,
    context: CrewMissionContext,
    attempt: number,
  ): Promise<CrewWorkerResult[]> {
    if (members.length === 0) return [];

    const first = members[0]!;
    const firstTask = this.buildCrewTask(first, taskMap, opts.sessionContext, context, attempt);

    this.eventBus.emit({
      type: 'crew_mission_phase',
      missionId: context.missionId,
      phase: 'handoff_initial',
      crew: first.crew.callsign,
    } as never);

    const firstResult = await this.executeMemberWorker(opts, first, firstTask, context);
    if (!firstResult.success) return [firstResult];

    context.addArtifact({
      workerId: firstResult.workerId,
      crewId: firstResult.crewId,
      crewName: firstResult.crewName,
      callsign: firstResult.callsign,
      type: 'output',
      content: `[Handoff base from @${firstResult.callsign}]: ${firstResult.output.slice(0, 2000)}`,
    });

    this.eventBus.emit({
      type: 'crew_mission_phase',
      missionId: context.missionId,
      phase: 'handoff_refine',
    } as never);

    const results: CrewWorkerResult[] = [];
    for (const handler of members) {
      const refineTask = [
        `[HANDOFF — refine work from ${first.crew.name}]`,
        `Add your perspective as ${handler.crew.title || handler.crew.name}.`,
        '',
        'Original output to refine:',
        firstResult.output.slice(0, 4000),
        '',
        'Deliver an improved, complete result for your specialty.',
      ].join('\n');
      const result = await this.executeMemberWorker(opts, handler, refineTask, context);
      results.push(result);
    }

    return results.length > 0 ? results : [firstResult];
  }

  private async executeMemberWorker(
    opts: CrewMissionOptions,
    member: CrewMember,
    task: string,
    context: CrewMissionContext,
  ): Promise<CrewWorkerResult> {
    try {
      const worker = new CrewWorker({
        parentAgent: opts.agent,
        crew: member.crew,
        task,
        missionContext: context,
        eventBus: this.eventBus,
        planMode: opts.planMode,
        missionId: context.missionId,
      });
      return await worker.execute();
    } catch (err) {
      return {
        workerId: `crew-worker-${member.crew.id}-error`,
        crewId: member.crew.id,
        crewName: member.crew.name,
        callsign: member.crew.callsign,
        success: false,
        output: err instanceof Error ? err.message : String(err),
        elapsed: 0,
      };
    }
  }

  private async runSequential(
    opts: CrewMissionOptions,
    members: CrewMember[],
    taskMap: Map<string, string>,
    context: CrewMissionContext,
    attempt: number,
  ): Promise<CrewWorkerResult[]> {
    const results: CrewWorkerResult[] = [];
    for (const member of members) {
      const crewTask = this.buildCrewTask(member, taskMap, opts.sessionContext, context, attempt);
      const result = await this.executeMemberWorker(opts, member, crewTask, context);
      results.push(result);
      if (result.success) {
        context.addArtifact({
          workerId: result.workerId,
          crewId: result.crewId,
          crewName: result.crewName,
          callsign: result.callsign,
          type: 'output',
          content: `[Prior handoff from @${result.callsign}]: ${result.output.slice(0, 1500)}`,
        });
      }
    }
    return results;
  }

  private stripMentionTokens(message: string): string {
    return message.replace(/(?<!\w)@\w+/g, '').replace(/\s+/g, ' ').trim();
  }

  private buildCrewTask(
    member: CrewMember,
    taskMap: Map<string, string>,
    sessionContext: string | undefined,
    context: CrewMissionContext,
    attempt: number,
  ): string {
    const parts: string[] = [];
    if (sessionContext) parts.push(`[SESSION]\n${sessionContext}`);
    parts.push(`[ASSIGNED TO @${member.crew.callsign} — ${member.crew.name}]`);
    parts.push(taskMap.get(member.crew.id) ?? context.userMessage);
    if (attempt > 1) {
      parts.push('', `[RETRY ${attempt}] Address prior issues and complete the task fully.`);
    }
    return parts.join('\n');
  }

  private mergeWorkerResults(existing: CrewWorkerResult[], batch: CrewWorkerResult[]): CrewWorkerResult[] {
    const map = new Map(existing.map((w) => [w.crewId, w]));
    for (const w of batch) map.set(w.crewId, w);
    return [...map.values()];
  }

  private verifyWorkers(workers: CrewWorkerResult[]): { passed: boolean; issues: string[] } {
    const issues: string[] = [];
    if (workers.length === 0) {
      issues.push('No crew workers ran');
      return { passed: false, issues };
    }
    for (const w of workers) {
      if (!w.success) issues.push(`${w.crewName} failed`);
      else if (w.needsClarification) issues.push(`${w.crewName} needs clarification`);
      else if (w.output.length < 20) issues.push(`${w.crewName} returned insufficient output`);
      else if (/\[Error:|failed to|could not complete/i.test(w.output)) {
        issues.push(`${w.crewName} reported errors in output`);
      }
    }
    return { passed: issues.length === 0, issues };
  }

  private async runClarificationRound(
    opts: CrewMissionOptions,
    blocked: CrewWorkerResult[],
    context: CrewMissionContext,
  ): Promise<boolean> {
    let anyAnswered = false;
    for (const w of blocked) {
      const question = w.output.slice(0, 500);
      context.addInterMessage(w.crewName, 'Agent-X', question);
      this.eventBus.emit({
        type: 'crew_inter_message',
        from: w.crewName,
        to: 'Agent-X',
        content: question.slice(0, 300),
      } as never);

      if (!opts.waitForClarification) {
        context.setMemory(`clarification:${w.crewId}`, question);
        continue;
      }

      const prompt = `@${w.callsign} (${w.crewName}) needs clarification:\n\n${question}`;
      const answer = await opts.waitForClarification(prompt, undefined, true);
      context.addClarificationAnswer({ crewId: w.crewId, question, answer });
      context.setMemory(`clarification:${w.crewId}`, answer);
      context.addInterMessage('Agent-X', w.crewName, answer);
      this.eventBus.emit({
        type: 'crew_inter_message',
        from: 'Agent-X',
        to: w.crewName,
        content: answer.slice(0, 300),
      } as never);
      anyAnswered = true;
    }
    return anyAnswered || !opts.waitForClarification;
  }

  private async synthesizeResponses(
    opts: CrewMissionOptions,
    userMessage: string,
    responses: Array<{ member: string; content: string; callsign: string }>,
    success: boolean,
  ): Promise<string> {
    if (responses.length === 0) {
      return 'No crew members were available to handle this mission.';
    }
    if (responses.length === 1) {
      const r = responses[0]!;
      return `**@${r.callsign} (${r.member})**\n\n${r.content}`;
    }

    if (opts.crewOrchestrator && opts.mainSystemPrompt) {
      try {
        return await opts.crewOrchestrator.synthesizeMissionResponses(
          userMessage,
          responses,
          opts.mainSystemPrompt,
        );
      } catch {
        // fall through to string synthesis
      }
    }

    const header = success
      ? '**Mission complete** — consolidated crew report:\n'
      : '**Mission in progress** — crew updates:\n';
    const body = responses
      .map((r) => `### @${r.callsign} — ${r.member}\n${r.content}`)
      .join('\n\n---\n\n');
    return `${header}\n${body}\n\n---\n*Original request: ${userMessage.slice(0, 200)}*`;
  }

  private persist(opts: CrewMissionOptions, payload: Record<string, unknown>): void {
    opts.onMissionEvent?.(payload);
  }
}
