import type { EngineeringCrewMessage, CrewTopic } from './types.js';
import type { CrewRole } from './CrewRole.js';
import { getLogger } from '@agentx/shared';

/**
 * Progress event emitted by the CrewEnvironment for real-time UI updates (#12).
 * Fired on every `publish` and at the start/end of each `runRound`.
 */
export interface CrewProgressEvent {
  /** The round number (0-indexed). */
  round: number;
  /** The role that published a message, or 'system' for round-level events. */
  role: string;
  /** The topic/causeBy of the message. */
  topic: CrewTopic;
  /** Short summary of what happened. */
  summary: string;
  /** Timestamp. */
  timestamp: number;
  /** #19: Task ID of the crew run this event belongs to. */
  taskId?: string;
}

/** Callback for receiving progress events. */
export type CrewProgressCallback = (event: CrewProgressEvent) => void;

/**
 * Topic-addressed pub/sub bus hosting a set of `CrewRole`s for a single Engineering Crew run.
 *
 * Ported from MetaGPT's `Environment.publish_message`/`add_roles`/`member_addrs` (see
 * repos/metagpt/metagpt/environment/base_env.py, MIT licensed, studied for this design —
 * docs/engineering-crew/DESIGN.md Section 4.0). Each role declares the topics it watches;
 * `publish` delivers a message to every role watching that message's `causeBy` topic whose
 * name is in the message's `sendTo` set (or to everyone watching that topic, for `sendTo: '*'`).
 */
export class CrewEnvironment {
  private roles: Map<string, CrewRole> = new Map();
  readonly history: EngineeringCrewMessage[] = [];
  private progressCallback: CrewProgressCallback | null = null;
  private currentRound = 0;
  /** #19: Task ID to include in progress events. */
  private taskId: string | undefined;

  hire(role: CrewRole): void {
    this.roles.set(role.name, role);
    role.setEnvironment(this);
  }

  /** #19: Set the task ID for progress events. */
  setTaskId(taskId: string): void {
    this.taskId = taskId;
  }

  getRole(name: string): CrewRole | undefined {
    return this.roles.get(name);
  }

  getRoles(): CrewRole[] {
    return [...this.roles.values()];
  }

  /** Set a progress callback for real-time UI updates (#12). */
  setProgressCallback(cb: CrewProgressCallback | null): void {
    this.progressCallback = cb;
  }

  publish(message: EngineeringCrewMessage): void {
    this.history.push(message);
    // #12: Emit progress event on every publish
    if (this.progressCallback) {
      this.progressCallback({
        round: this.currentRound,
        role: message.sentFrom,
        topic: message.causeBy,
        summary: message.content.slice(0, 200),
        timestamp: Date.now(),
        taskId: this.taskId,
      });
    }
    for (const role of this.roles.values()) {
      if (role.name === message.sentFrom) continue;
      const addressed = message.sendTo === '*' || message.sendTo.has(role.name);
      if (addressed && role.isWatching(message.causeBy)) {
        role.deliver(message);
      }
    }
  }

  /** True once no role has any pending inbox messages to react to. */
  get isIdle(): boolean {
    return [...this.roles.values()].every((r) => !r.hasPendingWork());
  }

  /** Run one round: every role with pending work observes + acts once, in parallel.
   *
   * #17: After the parallel pass, do a second pass for roles that received new messages
   * during the first pass. This handles the case where Role A publishes a message that
   * Role B watches — B should be able to react in the same round, not wait for the next.
   */
  async runRound(): Promise<void> {
    const active = [...this.roles.values()].filter((r) => r.hasPendingWork());
    // #12: Emit round-start progress event
    if (this.progressCallback) {
      this.progressCallback({
        round: this.currentRound,
        role: 'system',
        topic: 'user_requirement' as CrewTopic, // neutral topic for system events
        summary: `Round ${this.currentRound + 1}: ${active.length} role(s) active (${active.map((r) => r.name).join(', ')})`,
        timestamp: Date.now(),
        taskId: this.taskId,
      });
    }
    await Promise.all(active.map((r) => r.reactOnce()));

    // #17: Keep doing passes for roles that became eligible during this round,
    // so multi-role SOP chains (A -> B -> C) can resolve in a single round.
    const MAX_EXTRA_PASSES = 10;
    const alreadyRun = new Set(active.map((r) => r.name));
    let pass = 0;
    while (pass < MAX_EXTRA_PASSES) {
      const newlyActive = [...this.roles.values()].filter((r) => r.hasPendingWork() && !alreadyRun.has(r.name));
      if (newlyActive.length === 0) break;
      for (const role of newlyActive) {
        alreadyRun.add(role.name);
      }
      await Promise.all(newlyActive.map((r) => r.reactOnce()));
      pass++;
    }
    if (pass >= MAX_EXTRA_PASSES) {
      getLogger().warn('ENGINEERING_CREW', `runRound hit MAX_EXTRA_PASSES with ${[...this.roles.values()].filter((r) => r.hasPendingWork()).length} role(s) still pending; continuing in next round.`);
    }
    this.currentRound++;
  }

  messagesByTopic(topic: CrewTopic): EngineeringCrewMessage[] {
    return this.history.filter((m) => m.causeBy === topic);
  }
}
