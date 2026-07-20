export type AutomationScheduleType = 'once' | 'recurring';

export type AutomationTaskStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export type AutomationNotifyChannel = 'in_app' | 'desktop' | 'telegram' | 'slack' | 'email' | 'discord';

export type NotificationKind =
  | 'automation_success'
  | 'automation_failure'
  | 'automation_scheduled'
  | 'background_task_complete'
  | 'background_task_failed';

export interface AutomationRegisterInput {
  title: string;
  instruction: string;
  scheduleType: AutomationScheduleType;
  /** ISO 8601 datetime for one-time tasks */
  runAt?: string;
  /** Seconds from now for one-time tasks (server-computed; preferred for "in X minutes") */
  delaySeconds?: number;
  /** 5-field cron for recurring tasks */
  cron?: string;
  timezone?: string;
  taskKey?: string;
  notifyChannels?: AutomationNotifyChannel[];
  sourceChannel?: string;
  sourceSessionId: string;
  permissionSnapshot?: Array<{ toolName: string; decision: string; targetPath?: string | null }>;
}

export type AutomationLogLevel = 'info' | 'tool' | 'think' | 'ok' | 'err' | 'sys';

export interface AutomationRunLogEntry {
  id: string;
  taskId: string;
  runId: string;
  ts: string;
  level: AutomationLogLevel;
  label: string;
  detail?: string | null;
  eventType?: string | null;
}

export interface AutomationTaskRecord {
  id: string;
  /** Public pseudo ID: ax_auto_<randomAlphanumeric> */
  displayId: string;
  taskKey: string | null;
  title: string;
  instruction: string;
  scheduleType: AutomationScheduleType;
  cronExpression: string | null;
  runAt: string | null;
  timezone: string;
  status: AutomationTaskStatus;
  sourceChannel: string;
  sourceSessionId: string | null;
  notifyChannels: AutomationNotifyChannel[];
  permissionSnapshot: AutomationRegisterInput['permissionSnapshot'];
  pgbossJobId: string | null;
  pgbossScheduleName: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRecord {
  id: string;
  taskId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  channels: AutomationNotifyChannel[];
  deliveryStatus: Record<string, unknown>;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}
