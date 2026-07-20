import {
  getLogger,
} from '@agentx/shared';
import type {
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  BackgroundTaskResourceUsage,
  SubAgentRecord,
} from './background-task-types.js';
import type { BackgroundTaskStore } from './BackgroundTaskStore.js';
import type { BackgroundTaskEventPublisher } from './BackgroundTaskEventPublisher.js';
import { DefaultBackgroundTaskEventPublisher } from './BackgroundTaskEventPublisher.js';
import { BackgroundTaskHealthMonitor } from './BackgroundTaskHealthMonitor.js';
import type { AgentEventBus } from '../../events/EventBus.js';

const logger = getLogger();

function toStatus(status: string): BackgroundTaskStatus {
  const s = status as BackgroundTaskStatus;
  return ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'].includes(s) ? s : 'queued';
}

export class BackgroundTaskService {
  private tasks = new Map<string, BackgroundTaskRecord>();
  private store: BackgroundTaskStore | null = null;
  private publisher: BackgroundTaskEventPublisher | null = null;
  private healthMonitor: BackgroundTaskHealthMonitor | null = null;

  constructor() {
    const publisher = new DefaultBackgroundTaskEventPublisher();
    const monitor = new BackgroundTaskHealthMonitor();
    this.publisher = publisher;
    this.healthMonitor = monitor;
    monitor.setService(this);
  }

  setStore(store: BackgroundTaskStore | null): void {
    this.store = store;
  }

  setPublisher(publisher: BackgroundTaskEventPublisher | null): void {
    this.publisher = publisher;
  }

  setHealthMonitor(monitor: BackgroundTaskHealthMonitor | null): void {
    this.healthMonitor = monitor;
    if (monitor) monitor.setService(this);
  }

  /** Called once after storage is ready to reconcile in-memory state with DB. */
  async loadFromStore(): Promise<void> {
    if (!this.store) return;
    try {
      const cutoff = Date.now() - 60_000;
      const staleCount = await this.store.markStaleAsFailed(cutoff, 'Process restarted — task was interrupted');
      if (staleCount > 0) {
        logger.info('LOAD_FROM_STORE', `Marked ${staleCount} stale background task(s) as failed after restart`);
      }
      const records = await this.store.getAll({ limit: 10_000 });
      for (const record of records) {
        this.tasks.set(record.id, record);
      }
    } catch (err) {
      logger.error('LOAD_FROM_STORE', err instanceof Error ? err.message : String(err));
    }
  }

  registerTask(task: SubAgentRecord): void {
    const record = this.subAgentRecordToBackgroundTask(task);
    this.tasks.set(record.id, record);
    this.persist(record);
    this.healthMonitor?.start();
  }

  updateTask(id: string, patch: Partial<SubAgentRecord>): void {
    const existing = this.tasks.get(id);
    if (!existing) return;
    const updated: BackgroundTaskRecord = {
      ...existing,
      ...this.subAgentPatchToBackgroundPatch(patch),
      updatedAt: Date.now(),
    };
    this.tasks.set(id, updated);
    this.persist(updated);
    if (patch.status === 'running' && !existing.startTime) {
      this.publisher?.publishProgress(updated);
    }
  }

  recordHeartbeat(id: string): void {
    const existing = this.tasks.get(id);
    if (!existing) return;
    existing.lastHeartbeat = Date.now();
  }

  taskStarted(id: string, startTime = Date.now()): void {
    const existing = this.tasks.get(id);
    if (existing) {
      existing.lastHeartbeat = startTime;
    }
    this.updateTask(id, { status: 'running', startTime });
  }

  taskCompleted(id: string, result: string, resourceUsage?: BackgroundTaskResourceUsage): void {
    const existing = this.tasks.get(id);
    if (!existing) return;
    const endTime = Date.now();
    const updated: BackgroundTaskRecord = {
      ...existing,
      status: 'completed',
      result,
      resourceUsage: resourceUsage ?? existing.resourceUsage,
      endTime,
      consumed: existing.background ? existing.consumed : true,
      updatedAt: endTime,
    };
    this.tasks.set(id, updated);
    this.persist(updated);
    this.publisher?.publishComplete(updated, true);
  }

  taskFailed(id: string, error: string): void {
    const existing = this.tasks.get(id);
    if (!existing) return;
    const endTime = Date.now();
    const updated: BackgroundTaskRecord = {
      ...existing,
      status: 'failed',
      error,
      endTime,
      consumed: true,
      updatedAt: endTime,
    };
    this.tasks.set(id, updated);
    this.persist(updated);
    this.publisher?.publishComplete(updated, false);
  }

  taskCancelled(id: string): void {
    const existing = this.tasks.get(id);
    if (!existing) return;
    const endTime = Date.now();
    const updated: BackgroundTaskRecord = {
      ...existing,
      status: 'cancelled',
      endTime,
      updatedAt: endTime,
    };
    this.tasks.set(id, updated);
    this.persist(updated);
  }

  registerSessionEventBus(sessionId: string, eventBus: AgentEventBus): void {
    this.publisher?.registerSession(sessionId, eventBus);
  }

  unregisterSessionEventBus(sessionId: string): void {
    this.publisher?.unregisterSession(sessionId);
  }

  publishStatus(sessionId: string, records?: BackgroundTaskRecord[]): void {
    const resolved = records ?? (this.getTasksForSession(sessionId) as unknown as BackgroundTaskRecord[]);
    this.publisher?.publishStatus(sessionId, resolved);
  }

  publishProgress(id: string, snippet?: string): void {
    const record = this.tasks.get(id);
    if (record) this.publisher?.publishProgress(record, snippet);
  }

  getTask(id: string): SubAgentRecord | undefined {
    return this.tasks.get(id) as SubAgentRecord | undefined;
  }

  listTasks(): SubAgentRecord[] {
    return [...this.tasks.values()] as SubAgentRecord[];
  }

  getTasksForSession(sessionId: string): SubAgentRecord[] {
    return this.listTasks().filter((t) => t.parentSessionId === sessionId);
  }

  getRunningTasksForSession(sessionId: string): SubAgentRecord[] {
    return this.getTasksForSession(sessionId).filter(
      (t) => t.status === 'running' || t.status === 'pending' || t.status === 'queued',
    );
  }

  getCompletedTasksForSession(sessionId: string): SubAgentRecord[] {
    return this.getTasksForSession(sessionId).filter((t) => t.status === 'completed');
  }

  getAllRunning(): SubAgentRecord[] {
    return this.listTasks().filter((t) => t.status === 'running' || t.status === 'pending' || t.status === 'queued');
  }

  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (['pending', 'running', 'queued'].includes(task.status)) {
      this.taskCancelled(id);
      return true;
    }
    return false;
  }

  deleteTask(id: string): boolean {
    this.tasks.delete(id);
    return true;
  }

  getUnconsumedResults(sessionId: string): SubAgentRecord[] {
    return this.getTasksForSession(sessionId).filter(
      (t) => t.background && t.status === 'completed' && !t.consumed,
    );
  }

  consumeResults(sessionId: string): SubAgentRecord[] {
    const results = this.getUnconsumedResults(sessionId);
    for (const task of results) {
      const updated = { ...task, consumed: true, updatedAt: Date.now() } as BackgroundTaskRecord;
      this.tasks.set(task.id, updated);
      this.persist(updated);
    }
    return results;
  }

  clear(): void {
    this.tasks.clear();
  }

  private persist(record: BackgroundTaskRecord): void {
    if (this.store) {
      this.store.upsert(record).catch((err) => {
        logger.warn('PERSIST_FAIL', err instanceof Error ? err.message : String(err));
      });
    }
  }

  private subAgentRecordToBackgroundTask(task: SubAgentRecord): BackgroundTaskRecord {
    const now = Date.now();
    const channelContext = task.channelContext ??
      (task.inboundChannel
        ? {
            channel: task.inboundChannel,
            threadId: task.inboundThreadId,
            messageId: task.inboundMessageId,
          }
        : undefined);
    return {
      id: task.id,
      parentSessionId: task.parentSessionId ?? '',
      childSessionId: task.childSessionId,
      instruction: task.instruction,
      tools: task.tools ?? [],
      timeout: task.timeout ?? 60_000,
      status: toStatus(task.status),
      result: task.result,
      error: task.error,
      resourceUsage: task.resourceUsage,
      channelContext,
      background: task.background ?? false,
      consumed: task.consumed ?? false,
      startTime: task.startTime,
      endTime: task.endTime,
      createdAt: task.createdAt ?? task.startTime ?? now,
      updatedAt: task.updatedAt ?? now,
    };
  }

  private subAgentPatchToBackgroundPatch(patch: Partial<SubAgentRecord>): Partial<BackgroundTaskRecord> {
    const result: Partial<BackgroundTaskRecord> = {};
    if (patch.status) result.status = toStatus(patch.status);
    if (patch.result !== undefined) result.result = patch.result;
    if ('error' in patch) result.error = patch.error;
    if (patch.resourceUsage) result.resourceUsage = patch.resourceUsage as BackgroundTaskResourceUsage;
    if (patch.endTime !== undefined) result.endTime = patch.endTime;
    if (patch.consumed !== undefined) result.consumed = patch.consumed;
    return result;
  }
}
