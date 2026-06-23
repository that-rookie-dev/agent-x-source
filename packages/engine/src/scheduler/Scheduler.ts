import type { EngineEvent } from '@agentx/shared';
import { generateId, getDataDir } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  instruction: string;
  enabled: boolean;
  lastRun?: number;
  nextRun: number;
  runCount: number;
  oneShot?: boolean;
  /** File glob pattern — triggers job on file change (requires FileWatcher integration) */
  fileTrigger?: string;
}

interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

/**
 * Minimal cron expression parser supporting standard 5-field format:
 * minute hour day-of-month month day-of-week
 *
 * Supports: *, specific numbers, ranges (1-5), steps (x/n), lists (1,3,5)
 */
function parseCronField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const segments = part.split('/');
      const range = segments[0] ?? '*';
      const step = parseInt(segments[1] ?? '1', 10);
      const start = range === '*' ? min : parseInt(range, 10);
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (part.includes('-')) {
      const segments = part.split('-');
      const start = parseInt(segments[0] ?? '0', 10);
      const end = parseInt(segments[1] ?? '0', 10);
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return [...values].filter((v) => v >= min && v <= max).sort((a, b) => a - b);
}

function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseCronField(parts[0]!, 0, 59),
    hours: parseCronField(parts[1]!, 0, 23),
    daysOfMonth: parseCronField(parts[2]!, 1, 31),
    months: parseCronField(parts[3]!, 1, 12),
    daysOfWeek: parseCronField(parts[4]!, 0, 6),
  };
}

function getNextRunTime(cron: ParsedCron, after: Date = new Date()): number {
  const d = new Date(after.getTime() + 60_000); // start from next minute
  d.setSeconds(0, 0);

  // Search up to 1 year ahead
  const limit = d.getTime() + 365 * 24 * 60 * 60_000;

  while (d.getTime() < limit) {
    if (
      cron.months.includes(d.getMonth() + 1) &&
      cron.daysOfMonth.includes(d.getDate()) &&
      cron.daysOfWeek.includes(d.getDay()) &&
      cron.hours.includes(d.getHours()) &&
      cron.minutes.includes(d.getMinutes())
    ) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }

  return after.getTime() + 60 * 60_000; // fallback: 1 hour
}

export class Scheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private eventBus: AgentEventBus;
  private onJobTrigger: ((job: ScheduledJob) => void) | null = null;
  private persistPath: string;

  get taskCount(): number {
    return this.jobs.size;
  }

  constructor(eventBus: AgentEventBus, sessionId?: string) {
    this.eventBus = eventBus;
    const dataDir = getDataDir();
    mkdirSync(dataDir, { recursive: true });
    this.persistPath = sessionId
      ? join(dataDir, 'sessions', sessionId, 'scheduler.json')
      : join(dataDir, 'scheduler.json');
    if (sessionId) {
      mkdirSync(join(dataDir, 'sessions'), { recursive: true });
      mkdirSync(join(dataDir, 'sessions', sessionId), { recursive: true });
    }
    this.restore();
  }

  /**
   * Persist all non-oneshot jobs to disk.
   */
  private persist(): void {
    try {
      const jobs = [...this.jobs.values()].filter((j) => !j.oneShot);
      writeFileSync(this.persistPath, JSON.stringify(jobs, null, 2));
    } catch { /* silent — persistence is best-effort */ }
  }

  /**
   * Restore recurring jobs from disk on startup.
   */
  private restore(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const data = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as ScheduledJob[];
      const now = Date.now();
      for (const job of data) {
        if (job.oneShot) continue; // Don't restore expired one-shots
        // Recompute next run time from now
        if (job.cron.startsWith('@every:')) {
          const match = job.cron.match(/@every:(\d+)s/);
          const intervalSecs = match ? parseInt(match[1]!, 10) : 60;
          job.nextRun = now + intervalSecs * 1000;
        } else {
          try {
            const parsed = parseCron(job.cron);
            job.nextRun = getNextRunTime(parsed);
          } catch {
            job.nextRun = now + 60_000; // fallback
          }
        }
        this.jobs.set(job.id, job);
      }
    } catch { /* silent — if corrupt, start fresh */ }
  }

  /**
   * Set a callback invoked when a scheduled job fires.
   * The callback receives the job — the agent should process its instruction.
   */
  setTriggerHandler(handler: (job: ScheduledJob) => void): void {
    this.onJobTrigger = handler;
  }

  /**
   * Handle a file change event — triggers any job whose fileTrigger pattern matches.
   */
  onFileChange(filePath: string): void {
    for (const job of this.jobs.values()) {
      if (!job.enabled || !job.fileTrigger) continue;
      try {
        const pattern = job.fileTrigger.replace(/\*/g, '.*').replace(/\?/g, '.');
        if (new RegExp(pattern).test(filePath)) {
          job.lastRun = Date.now();
          job.runCount++;
          this.onJobTrigger?.(job);
        }
      } catch { /* skip malformed patterns */ }
    }
  }

  addJob(name: string, cron: string, instruction: string): ScheduledJob {
    const parsed = parseCron(cron);
    const job: ScheduledJob = {
      id: generateId(),
      name,
      cron,
      instruction,
      enabled: true,
      nextRun: getNextRunTime(parsed),
      runCount: 0,
    };

    this.jobs.set(job.id, job);
    this.eventBus.emit({
      type: 'steer_message',
      taskId: job.id,
      instruction: `Scheduled job "${name}" (${cron}) — next run: ${new Date(job.nextRun).toLocaleTimeString()}`,
    } as EngineEvent);

    this.persist();
    this.ensureTimerRunning();
    return job;
  }

  /**
   * Add a one-shot timer that fires once after a delay (in seconds), then auto-removes.
   */
  addTimer(name: string, delaySecs: number, instruction: string): ScheduledJob {
    const job: ScheduledJob = {
      id: generateId(),
      name,
      cron: `@timer:${delaySecs}s`,
      instruction,
      enabled: true,
      nextRun: Date.now() + delaySecs * 1000,
      runCount: 0,
      oneShot: true,
    };

    this.jobs.set(job.id, job);
    this.eventBus.emit({
      type: 'steer_message',
      taskId: job.id,
      instruction: `Timer "${name}" set — fires in ${delaySecs}s`,
    } as EngineEvent);

    this.ensureTimerRunning();
    return job;
  }

  /**
   * Add a recurring timer that fires every N seconds. Useful for sub-minute intervals.
   */
  addRecurringTimer(name: string, intervalSecs: number, instruction: string): ScheduledJob {
    const job: ScheduledJob = {
      id: generateId(),
      name,
      cron: `@every:${intervalSecs}s`,
      instruction,
      enabled: true,
      nextRun: Date.now() + intervalSecs * 1000,
      runCount: 0,
      oneShot: false,
    };

    this.jobs.set(job.id, job);
    this.eventBus.emit({
      type: 'steer_message',
      taskId: job.id,
      instruction: `Recurring timer "${name}" set — repeats every ${intervalSecs}s`,
    } as EngineEvent);

    this.persist();
    this.ensureTimerRunning();
    return job;
  }

  removeJob(jobId: string): boolean {
    const deleted = this.jobs.delete(jobId);
    if (deleted) this.persist();
    if (this.jobs.size === 0) this.stop();
    return deleted;
  }

  /** Trigger a scheduled job immediately (manual "Run Now"). */
  runJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.lastRun = Date.now();
    job.runCount++;
    this.persist();
    this.eventBus.emit({
      type: 'steer_message',
      taskId: job.id,
      instruction: `▶ Manually triggered job "${job.name}" (run #${job.runCount})`,
    } as EngineEvent);
    if (this.onJobTrigger) this.onJobTrigger(job);
    return true;
  }

  getJobs(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  getEnabledJobs(): ScheduledJob[] {
    return [...this.jobs.values()].filter((j) => j.enabled);
  }

  toggleJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job) {
      job.enabled = !job.enabled;
      this.persist();
      return job.enabled;
    }
    return false;
  }

  start(): void {
    this.ensureTimerRunning();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureTimerRunning(): void {
    if (this.timer) return;
    // Check every 5 seconds for jobs/timers that need to fire
    this.timer = setInterval(() => this.tick(), 5_000);
  }

  private tick(): void {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (now >= job.nextRun) {
        job.lastRun = now;
        job.runCount++;

        if (job.oneShot) {
          // One-shot timer — fire and remove
          this.jobs.delete(job.id);
          this.eventBus.emit({
            type: 'steer_message',
            taskId: job.id,
            instruction: `⏰ Reminder: "${job.name}" — time's up!`,
          } as EngineEvent);
        } else if (job.cron.startsWith('@every:')) {
          // Recurring timer with second-level interval
          const match = job.cron.match(/@every:(\d+)s/);
          const intervalSecs = match ? parseInt(match[1]!, 10) : 60;
          job.nextRun = now + intervalSecs * 1000;

          this.eventBus.emit({
            type: 'steer_message',
            taskId: job.id,
            instruction: `⏰ Recurring reminder "${job.name}" (every ${intervalSecs}s, run #${job.runCount})`,
          } as EngineEvent);
        } else {
          // Recurring cron — compute next run
          try {
            const parsed = parseCron(job.cron);
            job.nextRun = getNextRunTime(parsed);
          } catch {
            job.nextRun = now + 60_000; // fallback: 1 minute
          }

          this.eventBus.emit({
            type: 'steer_message',
            taskId: job.id,
            instruction: `⏰ Scheduled job "${job.name}" triggered (run #${job.runCount})`,
          } as EngineEvent);
        }

        if (this.onJobTrigger) {
          this.onJobTrigger(job);
        }
      }
    }

    // Stop timer if no jobs left
    if (this.jobs.size === 0) this.stop();
  }
}
