export type TurnPhase =
  | 'idle'
  | 'running'
  | 'awaiting_plan'
  | 'awaiting_mode'
  | 'awaiting_permission'
  | 'awaiting_step_cap'
  | 'done'
  | 'cancelled';

export interface TurnStateSnapshot {
  phase: TurnPhase;
  turnId: string | null;
  stage: string;
  step: number;
  startedAt: number | null;
  lastActivityAt: number | null;
}

const USER_WAIT_PHASES: ReadonlySet<TurnPhase> = new Set([
  'awaiting_permission',
  'awaiting_plan',
  'awaiting_mode',
  'awaiting_step_cap',
]);

export class TurnStateManager {
  private phase: TurnPhase = 'idle';
  private turnId: string | null = null;
  private stage = '';
  private step = 0;
  private startedAt: number | null = null;
  private lastActivityAt: number | null = null;
  private pausedAt: number | null = null;
  private pausedAccumMs = 0;

  start(turnId: string, stage = 'receiving'): void {
    this.turnId = turnId;
    this.phase = 'running';
    this.stage = stage;
    this.step = 0;
    this.startedAt = Date.now();
    this.lastActivityAt = this.startedAt;
    this.pausedAt = null;
    this.pausedAccumMs = 0;
  }

  setPhase(phase: TurnPhase, stage?: string): void {
    const wasUserWait = USER_WAIT_PHASES.has(this.phase);
    const isUserWait = USER_WAIT_PHASES.has(phase);
    if (!wasUserWait && isUserWait) {
      this.pausedAt = Date.now();
    } else if (wasUserWait && !isUserWait) {
      if (this.pausedAt != null) {
        this.pausedAccumMs += Date.now() - this.pausedAt;
        this.pausedAt = null;
      }
    }
    this.phase = phase;
    if (stage !== undefined) this.stage = stage;
    this.touch();
  }

  setStage(stage: string, step?: number): void {
    this.stage = stage;
    if (step !== undefined) this.step = step;
    this.touch();
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  complete(): void {
    this.phase = 'done';
    this.touch();
  }

  cancel(): void {
    this.phase = 'cancelled';
    this.touch();
  }

  reset(): void {
    this.phase = 'idle';
    this.turnId = null;
    this.stage = '';
    this.step = 0;
    this.startedAt = null;
    this.lastActivityAt = null;
    this.pausedAt = null;
    this.pausedAccumMs = 0;
  }

  /** Elapsed active (agent) time for this turn — excludes user-wait phases. */
  getElapsedMs(): number {
    if (this.startedAt == null) return 0;
    const end = this.pausedAt ?? Date.now();
    return Math.max(0, end - this.startedAt - this.pausedAccumMs);
  }

  getSnapshot(): TurnStateSnapshot {
    return {
      phase: this.phase,
      turnId: this.turnId,
      stage: this.stage,
      step: this.step,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  get phaseNow(): TurnPhase {
    return this.phase;
  }
}
