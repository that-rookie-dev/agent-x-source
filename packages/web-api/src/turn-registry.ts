import type { Message } from '@agentx/shared';

export type TurnStatus = 'running' | 'complete' | 'error' | 'cancelled';

export interface TurnRecord {
  turnId: string;
  sessionId: string;
  status: TurnStatus;
  message?: Message;
  error?: string;
  partialContent?: string;
  startedAt: number;
  completedAt?: number;
}

class TurnRegistry {
  private turns = new Map<string, TurnRecord>();
  private readonly maxAge = 30 * 60 * 1000;

  create(sessionId: string): TurnRecord {
    this.prune();
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: TurnRecord = {
      turnId,
      sessionId,
      status: 'running',
      startedAt: Date.now(),
    };
    this.turns.set(turnId, record);
    return record;
  }

  get(turnId: string): TurnRecord | undefined {
    return this.turns.get(turnId);
  }

  complete(turnId: string, message: Message): void {
    const r = this.turns.get(turnId);
    if (!r) return;
    r.status = 'complete';
    r.message = message;
    r.completedAt = Date.now();
  }

  fail(turnId: string, error: string, partialContent?: string): void {
    const r = this.turns.get(turnId);
    if (!r) return;
    r.status = 'error';
    r.error = error;
    r.partialContent = partialContent;
    r.completedAt = Date.now();
  }

  cancel(turnId: string): void {
    const r = this.turns.get(turnId);
    if (!r) return;
    r.status = 'cancelled';
    r.completedAt = Date.now();
  }

  setPartial(turnId: string, partialContent: string): void {
    const r = this.turns.get(turnId);
    if (r) r.partialContent = partialContent;
  }

  private prune(): void {
    const cutoff = Date.now() - this.maxAge;
    for (const [id, r] of this.turns) {
      if ((r.completedAt ?? r.startedAt) < cutoff) this.turns.delete(id);
    }
  }
}

export const turnRegistry = new TurnRegistry();
