import * as vscode from 'vscode';
import type { Scheduler, ScheduledJob } from '@agentx/engine';

interface ReminderTreeItem {
  kind: 'job' | 'empty';
  label: string;
  description?: string;
  tooltip?: string;
  job?: ScheduledJob;
}

export class SchedulerAdapter implements vscode.TreeDataProvider<ReminderTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<ReminderTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private scheduler: Scheduler | null = null;
  private disposables: vscode.Disposable[] = [];
  private firedNotifications = new Set<string>();

  attach(scheduler: Scheduler): void {
    this.scheduler = scheduler;
    this.wireTriggerHandler();
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ReminderTreeItem): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );

    item.description = element.description;
    item.tooltip = element.tooltip;
    item.contextValue = element.job?.enabled ? 'reminder-enabled' : 'reminder-disabled';

    if (element.job) {
      if (element.job.oneShot) {
        item.iconPath = new vscode.ThemeIcon('alarm');
      } else {
        item.iconPath = new vscode.ThemeIcon(element.job.enabled ? 'sync' : 'sync-ignored');
      }
    }

    return item;
  }

  getChildren(element?: ReminderTreeItem): ReminderTreeItem[] {
    if (element) return [];
    if (!this.scheduler) {
      return [{ kind: 'empty', label: 'No agent active' }];
    }

    const jobs = this.scheduler.getJobs();
    if (jobs.length === 0) {
      return [{ kind: 'empty', label: 'No scheduled reminders' }];
    }

    return jobs.sort((a, b) => a.nextRun - b.nextRun).map(job => {
      const nextRunDate = new Date(job.nextRun);
      const now = Date.now();
      let timeUntil: string;

      if (job.cron.startsWith('@timer:')) {
        const remaining = Math.max(0, job.nextRun - now);
        const secs = Math.ceil(remaining / 1000);
        if (secs < 60) timeUntil = `in ${secs}s`;
        else timeUntil = `in ${Math.ceil(secs / 60)}m`;
      } else if (job.cron.startsWith('@every:')) {
        const match = job.cron.match(/@every:(\d+)s/);
        const interval = match ? parseInt(match[1]!, 10) : 0;
        timeUntil = `every ${interval}s`;
      } else {
        timeUntil = `at ${nextRunDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      }

      const disabledTag = !job.enabled ? ' (disabled)' : '';
      const runInfo = job.runCount > 0 ? ` — ran ${job.runCount}x` : '';

      return {
        kind: 'job' as const,
        label: job.name + disabledTag,
        description: `${timeUntil}${runInfo}`,
        tooltip: [
          `Name: ${job.name}`,
          `Schedule: ${job.cron}`,
          `Instruction: ${job.instruction}`,
          `Next run: ${nextRunDate.toLocaleString()}`,
          `Run count: ${job.runCount}`,
          `Enabled: ${job.enabled}`,
          `One-shot: ${!!job.oneShot}`,
        ].join('\n'),
        job,
      };
    });
  }

  private wireTriggerHandler(): void {
    if (!this.scheduler) return;

    this.scheduler.setTriggerHandler((job) => {
      const notifKey = `${job.id}-${job.lastRun}`;
      if (this.firedNotifications.has(notifKey)) return;
      this.firedNotifications.add(notifKey);

      vscode.window.showInformationMessage(
        `\u23f0 ${job.name}: ${job.instruction}`,
        'Dismiss',
        'Run Again',
      ).then(action => {
        if (action === 'Run Again') {
          this.scheduler?.runJob(job.id);
        }
      });
    });
  }

  async addReminder(): Promise<void> {
    if (!this.scheduler) {
      vscode.window.showErrorMessage('No agent active.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Reminder name',
      placeHolder: 'e.g., Stand up and stretch',
    });
    if (!name) return;

    const delayChoice = await vscode.window.showQuickPick([
      { label: '1 minute', value: 60 },
      { label: '5 minutes', value: 300 },
      { label: '15 minutes', value: 900 },
      { label: '30 minutes', value: 1800 },
      { label: '1 hour', value: 3600 },
      { label: 'Custom (seconds)', value: -1 },
    ], { placeHolder: 'Fire after...' });
    if (!delayChoice) return;

    let delaySecs = delayChoice.value;
    if (delaySecs === -1) {
      const custom = await vscode.window.showInputBox({
        prompt: 'Delay in seconds',
        placeHolder: 'e.g., 120',
        validateInput: v => /^\d+$/.test(v) ? null : 'Must be a number',
      });
      if (!custom) return;
      delaySecs = parseInt(custom, 10);
    }

    const instruction = await vscode.window.showInputBox({
      prompt: 'Reminder message',
      placeHolder: 'e.g., Time to take a break!',
      value: name,
    });
    if (!instruction) return;

    this.scheduler.addTimer(name, delaySecs, instruction);
    this.refresh();
    vscode.window.showInformationMessage(`Reminder "${name}" set for ${delaySecs}s.`);
  }

  async removeReminder(item: ReminderTreeItem): Promise<void> {
    if (!this.scheduler || !item.job) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Remove reminder "${item.job.name}"?`,
      { modal: true },
      'Remove',
    );
    if (confirmed === 'Remove') {
      this.scheduler.removeJob(item.job.id);
      this.refresh();
    }
  }

  toggleReminder(item: ReminderTreeItem): void {
    if (!this.scheduler || !item.job) return;
    this.scheduler.toggleJob(item.job.id);
    this.refresh();
  }

  runNow(item: ReminderTreeItem): void {
    if (!this.scheduler || !item.job) return;
    this.scheduler.runJob(item.job.id);
    this.refresh();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
