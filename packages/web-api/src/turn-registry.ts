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
  private listeners = new Map<string, Set<(record: TurnRecord) => void>>();
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

  /** Return the most recent turn record for a session (running turns preferred). */
  getBySessionId(sessionId: string): TurnRecord | undefined {
    let best: TurnRecord | undefined;
    for (const record of this.turns.values()) {
      if (record.sessionId !== sessionId) continue;
      if (!best) { best = record; continue; }
      // Prefer a running turn; otherwise the most recently started.
      if (record.status === 'running' && best.status !== 'running') best = record;
      else if (record.status === best.status && record.startedAt > best.startedAt) best = record;
    }
    return best;
  }

  subscribe(turnId: string, listener: (record: TurnRecord) => void): () => void {
    let set = this.listeners.get(turnId);
    if (!set) {
      set = new Set();
      this.listeners.set(turnId, set);
    }
    set.add(listener);
    const existing = this.turns.get(turnId);
    if (existing && existing.status !== 'running') {
      listener(existing);
    }
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(turnId);
    };
  }

  private notify(turnId: string): void {
    const record = this.turns.get(turnId);
    if (!record) return;
    for (const listener of this.listeners.get(turnId) ?? []) {
      try { listener(record); } catch { /* ignore */ }
    }
  }

  complete(turnId: string, message: Message): void {
    const r = this.turns.get(turnId);
    if (!r) return;
    r.status = 'complete';
    r.message = message;
    r.completedAt = Date.now();
    this.notify(turnId);
  }

  fail(turnId: string, error: string, partialContent?: string): void {
    const r = this.turns.get(turnId);
    if (!r) return;
    r.status = 'error';
    r.error = error;
    r.partialContent = partialContent;
    r.completedAt = Date.now();
    this.notify(turnId);
  }

  cancel(turnId: string): void {
    const r = this.turns.get(turnId);
    if (!r) return;
    r.status = 'cancelled';
    r.completedAt = Date.now();
    this.notify(turnId);
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
