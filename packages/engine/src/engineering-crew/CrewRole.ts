import type { EngineeringCrewMessage, CrewTopic } from './types.js';
import { CrewMemory, RoleReactMode } from './types.js';
import type { CrewEnvironment } from './CrewEnvironment.js';

/**
 * Base class for an Engineering Crew role — a faithful port of MetaGPT's `Role` class
 * (repos/metagpt/metagpt/roles/role.py, MIT licensed).
 *
 * Implements the full `_observe` → `_think` → `_act` → `publish_message` loop:
 *
 * - **observe**: Pull new messages from the inbox, filter by watched topics, store in memory.
 * - **think**: Decide which action to take next. In `BY_ORDER` mode, advance through actions
 *   sequentially. In `REACT` mode, delegate to subclass `_think`. In `PLAN_AND_ACT`, plan
 *   first then execute. If a role has a single action, `_think` is trivial (always that action).
 * - **act**: Execute the current action via subclass `_act`.
 * - **publish**: Send the result message to the environment.
 *
 * Memory (mirrors MetaGPT's `RoleContext.memory`): each role maintains its own `CrewMemory`
 * instance that persists observed messages across rounds, enabling roles to reference prior
 * context (e.g. the Engineer can see the Architect's design and the ProjectManager's task list).
 *
 * React modes (mirrors MetaGPT's `RoleReactMode`):
 * - `REACT`: Standard think-act loop — subclass `_think` selects the next action.
 * - `BY_ORDER`: Actions execute in declaration order, one per round.
 * - `PLAN_AND_ACT`: Plan first, then execute tasks sequentially.
 */
export abstract class CrewRole {
  abstract readonly name: string;
  protected abstract readonly watchedTopics: Set<CrewTopic>;

  private inbox: EngineeringCrewMessage[] = [];
  protected environment?: CrewEnvironment;

  /** Per-role persistent memory (mirrors MetaGPT's RoleContext.memory). */
  readonly memory = new CrewMemory();

  /** Working memory for the current reaction cycle (cleared between rounds). */
  protected workingMemory: EngineeringCrewMessage[] = [];

  /** Current react mode — defaults to BY_ORDER (most roles have ordered actions). */
  protected reactMode: RoleReactMode = RoleReactMode.BY_ORDER;

  /** Max react loop iterations per round (only used in REACT mode). */
  protected maxReactLoop = 1;

  /** Current state index (-1 = idle/terminal). */
  protected state = -1;

  /** Whether to observe all messages from buffer (not just watched topics). */
  protected observeAllMsgFromBuffer = false;

  setEnvironment(env: CrewEnvironment): void {
    this.environment = env;
  }

  isWatching(topic: CrewTopic): boolean {
    return this.watchedTopics.has(topic);
  }

  deliver(message: EngineeringCrewMessage): void {
    this.inbox.push(message);
  }

  hasPendingWork(): boolean {
    return this.inbox.length > 0 || this.state >= 0;
  }

  /** Pull all pending inbox messages (observe), then think + act (react). */
  async reactOnce(): Promise<void> {
    const observed = this.observe();
    if (observed.length === 0 && this.state < 0) return;

    await this.react(observed);
  }

  // ─── Observe (mirrors MetaGPT's Role._observe) ───
  private observe(): EngineeringCrewMessage[] {
    const news = this.inbox;
    this.inbox = [];

    // Filter by watched topics (unless observeAllMsgFromBuffer)
    const filtered = this.observeAllMsgFromBuffer
      ? news
      : news.filter((m) => this.watchedTopics.has(m.causeBy));

    // Store in persistent memory
    this.memory.addBatch(filtered);
    this.workingMemory = filtered;

    return filtered;
  }

  // ─── React (mirrors MetaGPT's Role.react) ───
  private async react(news: EngineeringCrewMessage[]): Promise<void> {
    if (this.reactMode === RoleReactMode.REACT || this.reactMode === RoleReactMode.BY_ORDER) {
      await this.reactLoop(news);
    } else if (this.reactMode === RoleReactMode.PLAN_AND_ACT) {
      await this.planAndAct(news);
    }
    // Reset state after reaction is complete
    this.state = -1;
  }

  /** Standard think-act loop (mirrors MetaGPT's Role._react). */
  private async reactLoop(news: EngineeringCrewMessage[]): Promise<void> {
    let actionsTaken = 0;
    while (actionsTaken < this.maxReactLoop) {
      const hasTodo = await this.think(news);
      if (!hasTodo) break;
      await this.act(news);
      actionsTaken++;
    }
  }

  /** Plan and act mode (mirrors MetaGPT's Role._plan_and_act). */
  private async planAndAct(news: EngineeringCrewMessage[]): Promise<void> {
    // Subclass implements _planAndAct directly
    await this.planAndActImpl(news);
  }

  // ─── Think (mirrors MetaGPT's Role._think) ───
  /**
   * Decide what to do next. Default implementation: if there's only one action,
   * always select it. Subclasses override for multi-action roles.
   * Returns false if nothing to do.
   */
  protected async think(news: EngineeringCrewMessage[]): Promise<boolean> {
    if (news.length === 0 && this.state < 0) return false;
    // Default: single-action roles always have a todo
    this.state = 0;
    return true;
  }

  // ─── Act (mirrors MetaGPT's Role._act) ───
  /** Execute the current action. Subclasses must implement. */
  protected abstract act(news: EngineeringCrewMessage[]): Promise<void>;

  // ─── Plan and act (mirrors MetaGPT's Role._plan_and_act) ───
  /** For PLAN_AND_ACT mode. Subclasses override if they use this mode. */
  protected async planAndActImpl(_news: EngineeringCrewMessage[]): Promise<void> {
    // Default: fall back to single act
    await this.act(_news);
  }

  // ─── Publish (mirrors MetaGPT's Role.publish_message) ───
  protected publish(message: EngineeringCrewMessage): void {
    this.environment?.publish(message);
    // Also store in own memory
    this.memory.add(message);
  }

  /** Get memories filtered by watched topics (mirrors RoleContext.important_memory). */
  protected get importantMemory(): EngineeringCrewMessage[] {
    return this.memory.getByActions(this.watchedTopics);
  }

  /** Get all memories (mirrors RoleContext.history). */
  protected get history(): EngineeringCrewMessage[] {
    return this.memory.get();
  }

  /** Reset role state for a new run. */
  reset(): void {
    this.memory.clear();
    this.workingMemory = [];
    this.state = -1;
    this.inbox = [];
  }
}
