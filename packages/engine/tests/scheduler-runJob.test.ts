import { describe, it, expect } from 'vitest';
import { Scheduler } from '../src/scheduler/Scheduler.js';
import { AgentEventBus } from '../src/EventBus.js';

describe('Scheduler.runJob', () => {
  it('returns false for unknown job ids', () => {
    const sched = new Scheduler(new AgentEventBus());
    expect(sched.runJob('no-such-id')).toBe(false);
  });

  it('triggers the registered handler and increments run count', () => {
    const sched = new Scheduler(new AgentEventBus());
    const job = sched.addJob('test-job', '*/5 * * * *', 'do thing');
    const fired: string[] = [];
    sched.setTriggerHandler((j) => { fired.push(j.id); });

    const startCount = job.runCount;
    const ok = sched.runJob(job.id);

    expect(ok).toBe(true);
    expect(fired).toEqual([job.id]);
    const updated = sched.getJobs().find((j) => j.id === job.id)!;
    expect(updated.runCount).toBe(startCount + 1);
    expect(typeof updated.lastRun).toBe('number');

    sched.removeJob(job.id);
  });

  it('runJob is independent of the scheduling timer (manual trigger)', () => {
    const sched = new Scheduler(new AgentEventBus());
    // Far-future cron — should not auto-fire during this test
    const job = sched.addJob('future-job', '0 0 1 1 *', 'never');
    let count = 0;
    sched.setTriggerHandler(() => { count++; });

    sched.runJob(job.id);
    sched.runJob(job.id);
    sched.runJob(job.id);

    expect(count).toBe(3);
    sched.removeJob(job.id);
  });
});
