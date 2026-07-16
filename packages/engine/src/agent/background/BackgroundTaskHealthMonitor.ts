import { getLogger } from '@agentx/shared';
import type { BackgroundTaskService } from './BackgroundTaskService.js';
import type { BackgroundTaskRecord } from './background-task-types.js';

const HEALTH_CHECK_INTERVAL_MS = 2_000;
const HEARTBEAT_STALE_MULTIPLIER = 1.5;

export class BackgroundTaskHealthMonitor {
  private service: BackgroundTaskService | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  setService(service: BackgroundTaskService): void {
    this.service = service;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.check(), HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  private check(): void {
    if (!this.service) return;
    try {
      const now = Date.now();
      const tasks = this.service.listTasks();
      const bySession = new Map<string, BackgroundTaskRecord[]>();
      for (const task of tasks) {
        const sessionId = task.parentSessionId ?? 'unknown';
        if (task.status === 'running') {
          const lastHeartbeat = task.lastHeartbeat ?? task.startTime ?? task.createdAt ?? now;
          const timeout = task.timeout ?? 60_000;
          if (now - lastHeartbeat > timeout * HEARTBEAT_STALE_MULTIPLIER) {
            getLogger().warn(
              'HEALTH_FAIL',
              `Background task ${task.id.slice(0, 8)} for session ${sessionId.slice(0, 8)} stale — marking failed`,
            );
            this.service.taskFailed(task.id, 'Task became unresponsive and was terminated by health monitor');
            continue;
          }
          // Emit a progress heartbeat while running
          this.service.publishProgress(task.id);
        }
        const list = bySession.get(sessionId) ?? [];
        list.push(task as unknown as BackgroundTaskRecord);
        bySession.set(sessionId, list);
      }

      for (const [sessionId, sessionTasks] of bySession) {
        this.service.publishStatus(sessionId, sessionTasks);
      }
    } catch (err) {
      getLogger().error(
        'HEALTH_CHECK_ERROR',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
