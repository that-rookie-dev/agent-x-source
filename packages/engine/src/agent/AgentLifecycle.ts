export type AgentState = 'idle' | 'receiving' | 'processing' | 'responding' | 'disposed';

export interface AgentStateTransition {
  from: AgentState;
  to: AgentState;
  timestamp: number;
}

export interface LifecycleListener {
  (transition: AgentStateTransition): void;
}

export class AgentLifecycle {
  private state: AgentState = 'idle';
  private listeners = new Set<LifecycleListener>();
  private transitionHistory: AgentStateTransition[] = [];
  private readonly MAX_HISTORY = 50;
  private stateLocked = false;

  private static readonly VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
    idle: ['receiving'],
    receiving: ['processing', 'idle'],
    processing: ['responding', 'idle'],
    responding: ['idle', 'processing'],
    disposed: [],
  };

  getState(): AgentState {
    return this.state;
  }

  isProcessing(): boolean {
    return this.state === 'processing' || this.state === 'responding';
  }

  isAvailable(): boolean {
    return this.state === 'idle';
  }

  transition(to: AgentState): boolean {
    if (this.stateLocked || this.state === to) return false;

    const valid = AgentLifecycle.VALID_TRANSITIONS[this.state];
    if (!valid.includes(to)) {
      return false;
    }

    const transition: AgentStateTransition = {
      from: this.state,
      to,
      timestamp: Date.now(),
    };

    this.state = to;
    this.transitionHistory.push(transition);
    if (this.transitionHistory.length > this.MAX_HISTORY) {
      this.transitionHistory.shift();
    }

    this.notifyListeners(transition);
    return true;
  }

  /** Force state transition regardless of valid transitions (use for error recovery) */
  forceTransition(to: AgentState): void {
    const transition: AgentStateTransition = {
      from: this.state,
      to,
      timestamp: Date.now(),
    };

    this.state = to;
    this.transitionHistory.push(transition);
    this.notifyListeners(transition);
  }

  lock(): void {
    this.stateLocked = true;
  }

  unlock(): void {
    this.stateLocked = false;
  }

  onTransition(listener: LifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory(): AgentStateTransition[] {
    return [...this.transitionHistory];
  }

  /** Reset stuck state after timeout (self-healing) */
  resetIfStuck(timeoutMs: number): boolean {
    if (this.state === 'processing' || this.state === 'responding') {
      const lastTransition = this.transitionHistory.at(-1);
      if (lastTransition && (Date.now() - lastTransition.timestamp) > timeoutMs) {
        this.forceTransition('idle');
        return true;
      }
    }
    return false;
  }

  private notifyListeners(transition: AgentStateTransition): void {
    for (const listener of this.listeners) {
      try { listener(transition); } catch { /* swallow */ }
    }
  }
}
