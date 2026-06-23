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

export class TurnStateManager {
  private phase: TurnPhase = 'idle';
  private turnId: string | null = null;
  private stage = '';
  private step = 0;
  private startedAt: number | null = null;
  private lastActivityAt: number | null = null;

  start(turnId: string, stage = 'receiving'): void {
    this.turnId = turnId;
    this.phase = 'running';
    this.stage = stage;
    this.step = 0;
    this.startedAt = Date.now();
    this.lastActivityAt = this.startedAt;
  }

  setPhase(phase: TurnPhase, stage?: string): void {
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
