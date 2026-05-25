import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { getSchedulerInstance } from '../../commands/builtin/schedule.js';

/**
 * Set a reminder or recurring task. The agent uses this tool autonomously when
 * the user asks to be reminded of something or wants a repeating task.
 */
export async function reminderSet(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const name = (args['name'] as string) ?? 'Reminder';
  const message = (args['message'] as string) ?? name;
  const delaySeconds = args['delay_seconds'] as number | undefined;
  const intervalSeconds = args['interval_seconds'] as number | undefined;
  const intervalMinutes = args['interval_minutes'] as number | undefined;
  const cron = args['cron'] as string | undefined;
  const atTime = args['at_time'] as string | undefined;

  const scheduler = getSchedulerInstance();
  if (!scheduler) {
    return { success: false, output: 'Scheduler not available', error: 'NO_SCHEDULER' };
  }

  // Absolute time — convert ISO 8601 string to delay_seconds from now
  if (atTime) {
    const targetMs = new Date(atTime).getTime();
    if (isNaN(targetMs)) {
      return { success: false, output: `Invalid at_time format: "${atTime}". Use ISO 8601 (e.g. 2026-05-25T17:04:00+05:30).`, error: 'INVALID_TIME' };
    }
    const nowMs = Date.now();
    const delaySecs = Math.round((targetMs - nowMs) / 1000);
    if (delaySecs <= 0) {
      return { success: false, output: `The time "${atTime}" is in the past. Current time: ${new Date().toISOString()}`, error: 'TIME_IN_PAST' };
    }
    const job = scheduler.addTimer(name, delaySecs, message);
    const targetStr = new Date(targetMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return { success: true, output: `Reminder "${name}" set for ${targetStr} (in ${delaySecs}s). (ID: ${job.id})` };
  }

  // Recurring timer with sub-minute interval (seconds-level)
  if (intervalSeconds && intervalSeconds > 0) {
    const job = scheduler.addRecurringTimer(name, intervalSeconds, message);
    const timeStr = intervalSeconds >= 60
      ? `${Math.round(intervalSeconds / 60)} minute(s)`
      : `${intervalSeconds} second(s)`;
    return { success: true, output: `Recurring reminder "${name}" set — repeats every ${timeStr}. (ID: ${job.id})` };
  }

  // One-shot reminder (delay in seconds)
  if (delaySeconds && delaySeconds > 0) {
    const job = scheduler.addTimer(name, delaySeconds, message);
    const timeStr = delaySeconds >= 60
      ? `${Math.round(delaySeconds / 60)} minute(s)`
      : `${delaySeconds} second(s)`;
    return { success: true, output: `Reminder "${name}" set — I'll remind you in ${timeStr}. (ID: ${job.id})` };
  }

  // Recurring task — user provides interval in minutes or a cron expression
  if (intervalMinutes && intervalMinutes > 0) {
    // Convert interval to cron: every N minutes
    const cronExpr = intervalMinutes >= 60
      ? `0 */${Math.round(intervalMinutes / 60)} * * *`
      : `*/${intervalMinutes} * * * *`;
    const job = scheduler.addJob(name, cronExpr, message);
    return { success: true, output: `Recurring reminder "${name}" set — repeats every ${intervalMinutes} minute(s). (ID: ${job.id})` };
  }

  if (cron) {
    const job = scheduler.addJob(name, cron, message);
    return { success: true, output: `Scheduled task "${name}" created with schedule: ${cron}. (ID: ${job.id})` };
  }

  return { success: false, output: 'Please specify either delay_seconds (for one-time reminder) or interval_minutes (for recurring).', error: 'MISSING_PARAMS' };
}

/**
 * List active reminders and scheduled tasks.
 */
export async function reminderList(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const scheduler = getSchedulerInstance();
  if (!scheduler) {
    return { success: false, output: 'Scheduler not available', error: 'NO_SCHEDULER' };
  }

  const jobs = scheduler.getJobs();
  if (jobs.length === 0) {
    return { success: true, output: 'No active reminders or scheduled tasks.' };
  }

  const lines = jobs.map((j) => {
    const type = j.oneShot ? '⏱ One-time' : '🔄 Recurring';
    const status = j.enabled ? 'active' : 'paused';
    const nextStr = new Date(j.nextRun).toLocaleString();
    return `${type} | "${j.name}" | Next: ${nextStr} | Status: ${status} | ID: ${j.id}`;
  });

  return { success: true, output: `Active reminders/tasks:\n${lines.join('\n')}` };
}

/**
 * Cancel/remove a reminder or scheduled task.
 */
export async function reminderCancel(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const id = args['id'] as string | undefined;
  const name = args['name'] as string | undefined;

  const scheduler = getSchedulerInstance();
  if (!scheduler) {
    return { success: false, output: 'Scheduler not available', error: 'NO_SCHEDULER' };
  }

  if (id) {
    if (scheduler.removeJob(id)) {
      return { success: true, output: `Reminder/task removed (ID: ${id}).` };
    }
    return { success: false, output: `No reminder found with ID: ${id}`, error: 'NOT_FOUND' };
  }

  if (name) {
    const jobs = scheduler.getJobs();
    const match = jobs.find((j) => j.name.toLowerCase().includes(name.toLowerCase()));
    if (match) {
      scheduler.removeJob(match.id);
      return { success: true, output: `Reminder "${match.name}" cancelled.` };
    }
    return { success: false, output: `No reminder found matching "${name}"`, error: 'NOT_FOUND' };
  }

  return { success: false, output: 'Please provide the reminder name or ID to cancel.', error: 'MISSING_PARAMS' };
}
