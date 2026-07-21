import type { InternalUserTurn } from '@agentx/shared';

export type QueuePriority = 'foreground' | 'normal' | 'background';

export interface QueuedItem {
  turn: InternalUserTurn;
  priority: QueuePriority;
  enqueuedAt: number;
  resolve: (value: void) => void;
  reject: (error: Error) => void;
}

export class CommandQueue {
  private sessionLanes = new Map<string, QueuedItem[]>();
  private globalQueue: QueuedItem[] = [];
  private maxConcurrent = 4;
  private activeCount = 0;
  private isProcessing = false;

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, max);
    // Raising capacity must wake waiters — otherwise Quiet→Max would stall until a release.
    this.processNext();
  }

  enqueue(
    sessionId: string,
    turn: InternalUserTurn,
    priority: QueuePriority = 'normal',
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const item: QueuedItem = {
        turn,
        priority,
        enqueuedAt: Date.now(),
        resolve,
        reject,
      };

      const lane = this.sessionLanes.get(sessionId) ?? [];
      lane.push(item);
      this.sessionLanes.set(sessionId, lane);

      this.globalQueue.push(item);

      this.processNext();
    });
  }

  release(sessionId: string): void {
    this.activeCount = Math.max(0, this.activeCount - 1);

    const lane = this.sessionLanes.get(sessionId);
    if (lane && lane.length === 0) {
      this.sessionLanes.delete(sessionId);
    }

    this.processNext();
  }

  cancelSession(sessionId: string): void {
    const lane = this.sessionLanes.get(sessionId);
    if (!lane) return;

    for (const item of lane) {
      item.reject(new Error(`Session "${sessionId}" was cancelled`));
    }

    this.sessionLanes.delete(sessionId);

    this.globalQueue = this.globalQueue.filter(
      (item) => item.turn.sessionId !== sessionId,
    );
  }

  getQueueLength(sessionId?: string): number {
    if (sessionId) {
      return this.sessionLanes.get(sessionId)?.length ?? 0;
    }
    return this.globalQueue.length;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  private processNext(): void {
    if (this.isProcessing) return;
    if (this.activeCount >= this.maxConcurrent) return;

    const next = this.dequeueNext();
    if (!next) return;

    this.isProcessing = true;

    try {
      next.resolve();
    } catch (e) {
      next.reject(e as Error);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  private dequeueNext(): QueuedItem | undefined {
    const priorityOrder: QueuePriority[] = [
      'foreground',
      'normal',
      'background',
    ];

    for (const priority of priorityOrder) {
      for (let i = 0; i < this.globalQueue.length; i++) {
        const item = this.globalQueue[i];

        if (item!.priority !== priority) continue;

        const sessionId = item!.turn.sessionId;
        const lane = this.sessionLanes.get(sessionId);

        if (!lane || lane[0] !== item) {
          this.globalQueue.splice(i, 1);
          continue;
        }

        if (this.activeCount >= this.maxConcurrent) return undefined;

        this.activeCount++;
        lane.shift();
        this.globalQueue.splice(i, 1);
        return item;
      }
    }

    return undefined;
  }
}
