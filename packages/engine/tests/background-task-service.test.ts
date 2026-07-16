import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackgroundTaskService } from '../src/agent/background/BackgroundTaskService.js';
import { BackgroundTaskHealthMonitor } from '../src/agent/background/BackgroundTaskHealthMonitor.js';
import type { BackgroundTaskStore, BackgroundTaskRecord } from '../src/agent/background/BackgroundTaskStore.js';

function createFakeStore(): BackgroundTaskStore & { records: BackgroundTaskRecord[]; calls: string[] } {
  const records: BackgroundTaskRecord[] = [];
  const calls: string[] = [];
  return {
    records,
    calls,
    async upsert(record: BackgroundTaskRecord) {
      calls.push(`upsert:${record.id}`);
      const idx = records.findIndex((r) => r.id === record.id);
      if (idx >= 0) records[idx] = record;
      else records.push(record);
    },
    async getById(id: string) {
      calls.push(`getById:${id}`);
      return records.find((r) => r.id === id) ?? undefined;
    },
    async getBySession(_sessionId: string, _opts?: { status?: string; limit?: number }) {
      calls.push('getBySession');
      return records;
    },
    async getRunning() {
      calls.push('getRunning');
      return records.filter((r) => r.status === 'running');
    },
    async getAll(_opts?: { limit?: number }) {
      calls.push('getAll');
      return records;
    },
    async markStaleAsFailed(_cutoff: number, _reason: string) {
      calls.push('markStaleAsFailed');
      return 0;
    },
    async deleteBySession(_sessionId: string) {
      calls.push('deleteBySession');
    },
  };
}

function taskRecord(id: string, parentSessionId = 'sess-1'): BackgroundTaskRecord {
  return {
    id,
    parentSessionId,
    instruction: 'test task',
    tools: [],
    timeout: 60_000,
    status: 'queued',
    background: true,
    consumed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('BackgroundTaskService', () => {
  let service: BackgroundTaskService;
  let store: ReturnType<typeof createFakeStore>;

  beforeEach(() => {
    service = new BackgroundTaskService();
    store = createFakeStore();
    service.setStore(store);
  });

  it('registers a task and persists it to the store', () => {
    service.registerTask(taskRecord('t1'));
    expect(store.calls).toContain('upsert:t1');
    const loaded = service.getTask('t1');
    expect(loaded).toBeTruthy();
    expect(loaded?.status).toBe('queued');
  });

  it('tracks task lifecycle and unconsumed results', () => {
    service.registerTask(taskRecord('t1'));
    service.taskStarted('t1', Date.now() - 1000);
    expect(service.getTask('t1')?.status).toBe('running');

    service.taskCompleted('t1', 'done');
    const completed = service.getTask('t1');
    expect(completed?.status).toBe('completed');
    expect(completed?.consumed).toBe(false);
    expect(completed?.result).toBe('done');

    const unconsumed = service.getUnconsumedResults('sess-1');
    expect(unconsumed.length).toBe(1);
    expect(unconsumed[0]!.result).toBe('done');

    service.consumeResults('sess-1');
    expect(service.getTask('t1')?.consumed).toBe(true);
    expect(service.getUnconsumedResults('sess-1').length).toBe(0);
  });

  it('marks foreground tasks as consumed immediately on completion', () => {
    const task = { ...taskRecord('t2'), background: false };
    service.registerTask(task);
    service.taskCompleted('t2', 'result');
    expect(service.getTask('t2')?.consumed).toBe(true);
  });

  it('loads existing tasks from the store', async () => {
    store.records.push(taskRecord('t3'));
    await service.loadFromStore();
    expect(service.getTask('t3')).toBeTruthy();
    expect(service.getTasksForSession('sess-1').length).toBe(1);
  });

  it('cancels a running task', () => {
    service.registerTask(taskRecord('t4'));
    service.taskStarted('t4');
    service.taskCancelled('t4');
    expect(service.getTask('t4')?.status).toBe('cancelled');
  });
});

describe('BackgroundTaskHealthMonitor', () => {
  it('marks running tasks without recent heartbeats as failed', async () => {
    const service = new BackgroundTaskService();
    const store = createFakeStore();
    service.setStore(store);
    const monitor = new BackgroundTaskHealthMonitor();
    monitor.setService(service);

    const now = Date.now();
    service.registerTask({
      ...taskRecord('h1'),
      status: 'running',
      startTime: now - 120_000,
      lastHeartbeat: now - 120_000,
    });

    monitor.check();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const task = service.getTask('h1');
    expect(task?.status).toBe('failed');
    expect(task?.error).toContain('unresponsive');
    expect(store.calls).toContain('upsert:h1');
    monitor.stop();
  });

  it('does not fail running tasks with recent heartbeats', () => {
    const service = new BackgroundTaskService();
    service.setStore(createFakeStore());
    const monitor = new BackgroundTaskHealthMonitor();
    monitor.setService(service);

    const now = Date.now();
    service.registerTask({
      ...taskRecord('h2'),
      status: 'running',
      startTime: now,
      lastHeartbeat: now,
    });

    monitor.check();
    expect(service.getTask('h2')?.status).toBe('running');
    monitor.stop();
  });
});
