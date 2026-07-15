import { getLogger } from '@agentx/shared';
import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';
import type { TaskManager } from '../../agent/TaskManager.js';
import { BackgroundQueue } from '../../session/BackgroundQueue.js';

let taskManagerInstance: TaskManager | null = null;
let backgroundQueueInstance: BackgroundQueue | null = null;
let backgroundQueueWarned = false;

export function setTaskManagerInstance(tm: TaskManager): void {
  taskManagerInstance = tm;
}

/** @deprecated Use IJobQueue instead. */
export function setBackgroundQueueInstance(queue: BackgroundQueue): void {
  backgroundQueueInstance = queue;
  if (!backgroundQueueWarned) {
    backgroundQueueWarned = true;
    getLogger().warn('BACKGROUND_QUEUE', 'BackgroundQueue is deprecated; use IJobQueue instead.');
  }
}

/** @deprecated Use IJobQueue instead. */
export function getBackgroundQueueInstance(): BackgroundQueue | null {
  return backgroundQueueInstance;
}

export const bgCommand: CommandInterface = {
  name: 'bg',
  description: 'Background tasks — /bg <cmd> to run shell command, /bg (no args) to background current task',
  usage: '/bg [<command>|list|cancel <id>|result <id>]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const sub = args[0];

    // /bg list — list background tasks from the queue
    if (sub === 'list') {
      if (!backgroundQueueInstance) {
        context.emit('No background tasks.');
        return { success: true, action: 'none' };
      }
      const tasks = backgroundQueueInstance.listTasks();
      if (tasks.length === 0) {
        context.emit('No background tasks.');
        return { success: true, action: 'none' };
      }
      const lines = tasks.map((t) => {
        const age = Math.round((Date.now() - t.createdAt) / 1000);
        return `  [${t.status}] ${t.id.slice(0, 8)} — "${t.command.slice(0, 60)}" (${age}s ago) ${t.progress}`;
      });
      context.emit(`Background tasks:\n${lines.join('\n')}`);
      return { success: true, action: 'none' };
    }

    // /bg cancel <id> — cancel a background task
    if (sub === 'cancel') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /bg cancel <task-id>');
        return { success: false, action: 'none' };
      }
      if (!backgroundQueueInstance) {
        context.emit('No background tasks.');
        return { success: false, action: 'none' };
      }
      try {
        const ok = await backgroundQueueInstance.cancel(id);
        context.emit(ok ? `Task ${id.slice(0, 8)} cancelled.` : `Task not found or already completed.`);
        return { success: true, action: 'none' };
      } catch (err) {
        context.emit(`Failed to cancel task: ${err instanceof Error ? err.message : String(err)}`);
        return { success: false, action: 'none' };
      }
    }

    // /bg result <id> — show full output of a completed/failed task
    if (sub === 'result') {
      const id = args[1];
      if (!id) {
        context.emit('Usage: /bg result <task-id>');
        return { success: false, action: 'none' };
      }
      if (!backgroundQueueInstance) {
        context.emit('No background tasks.');
        return { success: false, action: 'none' };
      }
      const task = backgroundQueueInstance.getTask(id);
      if (!task) {
        context.emit(`Task ${id.slice(0, 8)} not found.`);
        return { success: false, action: 'none' };
      }
      if (task.status === 'queued' || task.status === 'running') {
        context.emit(`Task ${id.slice(0, 8)} is still ${task.status}.`);
        return { success: true, action: 'none' };
      }
      const header = `[${task.status}] ${task.command}\n${'─'.repeat(40)}`;
      const output = task.result ? `\n${task.result}` : '\n(no output)';
      context.emit(`${header}${output}`);
      return { success: true, action: 'none' };
    }

    // No args — background current foreground task (TaskManager)
    if (!sub) {
      if (!taskManagerInstance) {
        context.emit('Task manager not available.');
        return { success: false, action: 'none' };
      }
      const foreground = taskManagerInstance.getForegroundTask();
      if (!foreground) {
        context.emit('No foreground task to background.');
        return { success: false, action: 'none' };
      }
      taskManagerInstance.backgroundTask(foreground.id);
      context.emit(`Task "${foreground.name}" moved to background.`);
      return { success: true, action: 'none' };
    }

    // /bg <command> — run a shell command in the background queue
    const command = args.join(' ');
    if (!backgroundQueueInstance) {
      backgroundQueueInstance = new BackgroundQueue();
      setBackgroundQueueInstance(backgroundQueueInstance);
    }
    try {
      const task = await backgroundQueueInstance.enqueue(command);
      context.emit(`Background task ${task.id.slice(0, 8)} queued: "${command.slice(0, 60)}"`);
      return { success: true, action: 'none' };
    } catch (err) {
      context.emit(`Failed to queue task: ${err instanceof Error ? err.message : String(err)}`);
      return { success: false, action: 'none' };
    }
  },
};

export const tasksCommand: CommandInterface = {
  name: 'tasks',
  description: 'List active and completed background tasks',
  usage: '/tasks',
  async execute(_args: string[], context: CommandContext): Promise<CommandResult> {
    if (!taskManagerInstance) {
      context.emit('Task manager not available.');
      return { success: false, action: 'none' };
    }

    const all = taskManagerInstance.getAllTasks();
    if (all.length === 0) {
      context.emit('No tasks.');
      return { success: true, action: 'none' };
    }

    const background = taskManagerInstance.getBackgroundTasks();
    const foreground = taskManagerInstance.getForegroundTask();
    const running = taskManagerInstance.getRunningTasks();

    const lines: string[] = ['Tasks:'];

    if (foreground) {
      const elapsed = Math.round((Date.now() - foreground.startTime) / 1000);
      lines.push(`  [FG] ${foreground.name} — ${elapsed}s — ${foreground.tokensUsed} tokens`);
    }

    if (background.length > 0) {
      lines.push('');
      lines.push('  Background:');
      for (const t of background) {
        const elapsed = Math.round((Date.now() - t.startTime) / 1000);
        lines.push(`    • ${t.name} — ${t.status} — ${elapsed}s`);
      }
    }

    if (running.length === 0 && !foreground) {
      lines.push('  No running tasks.');
    }

    // Show recent completed tasks
    const completed = all.filter((t) => t.status === 'completed').slice(-3);
    if (completed.length > 0) {
      lines.push('');
      lines.push('  Recent:');
      for (const t of completed) {
        const elapsed = t.endTime ? Math.round((t.endTime - t.startTime) / 1000) : 0;
        lines.push(`    ✓ ${t.name} — ${elapsed}s`);
      }
    }

    context.emit(lines.join('\n'));
    return { success: true, action: 'none' };
  },
};
