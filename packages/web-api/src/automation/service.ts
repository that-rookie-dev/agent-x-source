import { parseExpression } from 'cron-parser';
import type {
  AutomationNotifyChannel,
  AutomationRegisterInput,
  AutomationRunLogEntry,
  AutomationTaskRecord,
  NotificationKind,
  NotificationRecord,
} from '@agentx/shared';
import { generateAxId, generateId, getLogger } from '@agentx/shared';
import { broadcast } from '../ws.js';
import { getEngine } from '../engine.js';
import { getTelegramRuntimeHints } from '../channels-sync.js';
import { getPgBoss, getAutomationQueueName } from './boss.js';

export interface AutomationDbPool {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

function rowToTask(row: Record<string, unknown>): AutomationTaskRecord {
  return {
    id: row['id'] as string,
    displayId: (row['display_id'] as string) ?? '',
    taskKey: (row['task_key'] as string) ?? null,
    title: row['title'] as string,
    instruction: row['instruction'] as string,
    scheduleType: row['schedule_type'] as AutomationTaskRecord['scheduleType'],
    cronExpression: (row['cron_expression'] as string) ?? null,
    runAt: row['run_at'] ? new Date(row['run_at'] as string).toISOString() : null,
    timezone: (row['timezone'] as string) ?? 'UTC',
    status: row['status'] as AutomationTaskRecord['status'],
    sourceChannel: (row['source_channel'] as string) ?? 'web',
    sourceSessionId: (row['source_session_id'] as string) ?? null,
    notifyChannels: (row['notify_channels'] as AutomationNotifyChannel[]) ?? ['in_app'],
    permissionSnapshot: row['permission_snapshot'] as AutomationTaskRecord['permissionSnapshot'],
    pgbossJobId: (row['pgboss_job_id'] as string) ?? null,
    pgbossScheduleName: (row['pgboss_schedule_name'] as string) ?? null,
    lastRunAt: row['last_run_at'] ? new Date(row['last_run_at'] as string).toISOString() : null,
    lastRunStatus: (row['last_run_status'] as string) ?? null,
    nextRunAt: row['next_run_at'] ? new Date(row['next_run_at'] as string).toISOString() : null,
    runCount: Number(row['run_count'] ?? 0),
    createdAt: new Date(row['created_at'] as string).toISOString(),
    updatedAt: new Date(row['updated_at'] as string).toISOString(),
  };
}

function rowToNotification(row: Record<string, unknown>): NotificationRecord {
  return {
    id: row['id'] as string,
    taskId: (row['task_id'] as string) ?? null,
    kind: row['kind'] as NotificationKind,
    title: row['title'] as string,
    body: row['body'] as string,
    payload: (row['payload'] as Record<string, unknown>) ?? null,
    channels: (row['channels'] as AutomationNotifyChannel[]) ?? ['in_app'],
    deliveryStatus: (row['delivery_status'] as Record<string, unknown>) ?? {},
    readAt: row['read_at'] ? new Date(row['read_at'] as string).toISOString() : null,
    dismissedAt: row['dismissed_at'] ? new Date(row['dismissed_at'] as string).toISOString() : null,
    createdAt: new Date(row['created_at'] as string).toISOString(),
  };
}

function computeNextRunAt(task: AutomationTaskRecord): string | null {
  if (task.status !== 'active') return null;
  if (task.scheduleType === 'once') {
    const runAt = task.runAt ? new Date(task.runAt) : null;
    if (!runAt || runAt.getTime() <= Date.now()) return null;
    return runAt.toISOString();
  }
  if (task.cronExpression) {
    try {
      return parseExpression(task.cronExpression, { tz: task.timezone || 'UTC' }).next().toDate().toISOString();
    } catch { /* fall through */ }
  }
  return task.nextRunAt;
}

function rowToLogEntry(row: Record<string, unknown>): AutomationRunLogEntry {
  return {
    id: row['id'] as string,
    taskId: row['task_id'] as string,
    runId: row['run_id'] as string,
    ts: new Date(row['created_at'] as string).toISOString(),
    level: row['level'] as AutomationRunLogEntry['level'],
    label: row['label'] as string,
    detail: (row['detail'] as string) ?? null,
    eventType: (row['event_type'] as string) ?? null,
  };
}

function enrichTask(task: AutomationTaskRecord): AutomationTaskRecord {
  return { ...task, nextRunAt: computeNextRunAt(task) };
}

export class AutomationService {
  constructor(private pool: AutomationDbPool) {}

  private async allocateDisplayId(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const displayId = generateAxId('auto');
      const { rows } = await this.pool.query(
        'SELECT 1 FROM automation_tasks WHERE display_id = $1 LIMIT 1',
        [displayId],
      );
      if (rows.length === 0) return displayId;
    }
    throw new Error('Failed to allocate automation display id');
  }

  async backfillMissingDisplayIds(): Promise<void> {
    const { rows } = await this.pool.query<{ id: string }>(
      'SELECT id FROM automation_tasks WHERE display_id IS NULL',
    );
    for (const row of rows) {
      const displayId = await this.allocateDisplayId();
      await this.pool.query('UPDATE automation_tasks SET display_id = $2 WHERE id = $1', [row.id, displayId]);
    }
  }

  async resolveTaskId(idOrDisplayId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM automation_tasks
       WHERE id = $1 OR display_id = $1 OR task_key = $1
       LIMIT 1`,
      [idOrDisplayId],
    );
    return rows[0]?.id ?? null;
  }

  async appendRunLog(
    taskId: string,
    runId: string,
    entry: {
      level: AutomationRunLogEntry['level'];
      label: string;
      detail?: string | null;
      eventType?: string | null;
      ts?: string;
    },
  ): Promise<void> {
    const id = generateId();
    const createdAt = entry.ts ?? new Date().toISOString();
    await this.pool.query(
      `INSERT INTO automation_run_logs (id, task_id, run_id, level, label, detail, event_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, taskId, runId, entry.level, entry.label, entry.detail ?? null, entry.eventType ?? null, createdAt],
    );
  }

  async listRunLogs(taskIdOrDisplayId: string, limit = 80): Promise<AutomationRunLogEntry[]> {
    const taskId = await this.resolveTaskId(taskIdOrDisplayId);
    if (!taskId) return [];
    const capped = Math.min(Math.max(limit, 1), 200);
    const { rows } = await this.pool.query(
      `SELECT * FROM automation_run_logs WHERE task_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [taskId, capped],
    );
    return rows.reverse().map((r) => rowToLogEntry(r as Record<string, unknown>));
  }

  private async stopBossJobs(row: Record<string, unknown>): Promise<void> {
    const boss = getPgBoss();
    if (!boss) return;
    if (row['pgboss_schedule_name']) {
      await boss.unschedule(row['pgboss_schedule_name'] as string);
    }
    if (row['pgboss_job_id']) {
      await boss.cancel(getAutomationQueueName(), row['pgboss_job_id'] as string);
    }
  }

  private async scheduleBossJobs(row: Record<string, unknown>): Promise<{ pgbossJobId: string | null; nextRunAt: Date | null }> {
    const boss = getPgBoss();
    if (!boss) throw new Error('Job queue not ready');
    const queue = getAutomationQueueName();
    const id = row['id'] as string;
    const scheduleType = row['schedule_type'] as string;
    const timezone = (row['timezone'] as string) ?? 'UTC';
    const taskKey = row['task_key'] as string | null;

    if (scheduleType === 'once') {
      const runAt = new Date(row['run_at'] as string);
      if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
        throw new Error('One-time run_at is invalid or in the past');
      }
      const pgbossJobId = await boss.send(queue, { taskId: id }, {
        startAfter: runAt,
        singletonKey: taskKey ?? id,
      });
      return { pgbossJobId, nextRunAt: runAt };
    }

    const cron = (row['cron_expression'] as string)?.trim();
    if (!cron || cron.split(/\s+/).length !== 5) throw new Error('Invalid cron expression');
    const scheduleName = (row['pgboss_schedule_name'] as string) ?? (taskKey ? `automation:${taskKey}` : `automation:${id}`);
    await boss.createQueue(scheduleName).catch(() => {});
    await boss.schedule(scheduleName, cron, { taskId: id }, { tz: timezone });
    const nextRunAt = parseExpression(cron, { tz: timezone }).next().toDate();
    return { pgbossJobId: null, nextRunAt };
  }

  async confirmSession(sessionId: string, note?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.pool.query(
        `INSERT INTO automation_session_confirmations (session_id, confirmed_at, confirmation_note)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (session_id) DO UPDATE SET confirmed_at = NOW(), confirmation_note = EXCLUDED.confirmation_note`,
        [sessionId, note ?? null],
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async isSessionConfirmed(sessionId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ confirmed_at: Date }>(
      `SELECT confirmed_at FROM automation_session_confirmations
       WHERE session_id = $1 AND confirmed_at > NOW() - INTERVAL '2 hours'`,
      [sessionId],
    );
    return rows.length > 0;
  }

  async clearSessionConfirmation(sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM automation_session_confirmations WHERE session_id = $1', [sessionId]);
  }

  async registerTask(input: AutomationRegisterInput): Promise<{ ok: boolean; taskId?: string; displayId?: string; error?: string }> {
    const boss = getPgBoss();
    if (!boss) return { ok: false, error: 'Job queue not ready' };

    const notifyChannels: AutomationNotifyChannel[] = input.notifyChannels ?? ['in_app'];
    const timezone = input.timezone ?? 'UTC';
    const queue = getAutomationQueueName();

    if (input.taskKey) {
      await this.cancelTask(input.taskKey, input.sourceSessionId, { skipConfirmationClear: true });
    }

    let permissionSnapshot = input.permissionSnapshot;
    if (!permissionSnapshot) {
      try {
        const { rows } = await this.pool.query<{ tool_name: string; decision: string; target_path: string | null }>(
          `SELECT tool_name, decision, target_path FROM permissions WHERE session_id = $1 AND decision = 'allow_always'`,
          [input.sourceSessionId],
        );
        permissionSnapshot = rows.map((r) => ({
          toolName: r.tool_name,
          decision: r.decision,
          targetPath: r.target_path,
        }));
      } catch { /* best-effort */ }
    }

    const id = generateId();
    const displayId = await this.allocateDisplayId();
    let pgbossJobId: string | null = null;
    let pgbossScheduleName: string | null = null;
    let nextRunAt: Date | null = null;
    let resolvedRunAt: string | null = null;

    try {
      if (input.scheduleType === 'once') {
        let runAt: Date;
        if (input.delaySeconds != null && input.delaySeconds > 0) {
          runAt = new Date(Date.now() + input.delaySeconds * 1000);
        } else if (input.runAt) {
          runAt = new Date(input.runAt);
        } else {
          return { ok: false, error: 'run_at or delay_seconds is required for one-time tasks' };
        }
        if (Number.isNaN(runAt.getTime())) {
          return { ok: false, error: `Invalid run_at: ${input.runAt}` };
        }
        if (runAt.getTime() <= Date.now()) {
          return { ok: false, error: 'run_at must be in the future' };
        }
        resolvedRunAt = runAt.toISOString();
        pgbossJobId = await boss.send(queue, { taskId: id }, {
          startAfter: runAt,
          singletonKey: input.taskKey ?? id,
        });
        nextRunAt = runAt;
      } else {
        const cron = input.cron!.trim();
        if (cron.split(/\s+/).length !== 5) {
          return { ok: false, error: 'cron must be a 5-field expression' };
        }
        pgbossScheduleName = input.taskKey ? `automation:${input.taskKey}` : `automation:${id}`;
        await boss.createQueue(pgbossScheduleName).catch(() => {});
        await boss.schedule(pgbossScheduleName, cron, { taskId: id }, { tz: timezone });
        nextRunAt = parseExpression(cron, { tz: timezone }).next().toDate();
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    try {
      await this.pool.query(
        `INSERT INTO automation_tasks (
          id, display_id, task_key, title, instruction, schedule_type, cron_expression, run_at, timezone,
          status, source_channel, source_session_id, notify_channels, permission_snapshot,
          pgboss_job_id, pgboss_schedule_name, next_run_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          displayId,
          input.taskKey ?? null,
          input.title,
          input.instruction,
          input.scheduleType,
          input.scheduleType === 'recurring' ? input.cron : null,
          input.scheduleType === 'once' ? resolvedRunAt : null,
          timezone,
          input.sourceChannel ?? 'web',
          input.sourceSessionId,
          JSON.stringify(notifyChannels),
          permissionSnapshot ? JSON.stringify(permissionSnapshot) : null,
          pgbossJobId,
          pgbossScheduleName,
          nextRunAt,
        ],
      );
      await this.clearSessionConfirmation(input.sourceSessionId);
      return { ok: true, taskId: id, displayId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listTasks(sessionId?: string): Promise<AutomationTaskRecord[]> {
    const { rows } = sessionId
      ? await this.pool.query(
          `SELECT * FROM automation_tasks WHERE source_session_id = $1 AND status <> 'cancelled' ORDER BY created_at DESC`,
          [sessionId],
        )
      : await this.pool.query(
          `SELECT * FROM automation_tasks WHERE status <> 'cancelled' ORDER BY created_at DESC LIMIT 100`,
        );
    return rows.map((r) => enrichTask(rowToTask(r as Record<string, unknown>)));
  }

  async getTask(taskIdOrDisplayId: string): Promise<AutomationTaskRecord | null> {
    const taskId = await this.resolveTaskId(taskIdOrDisplayId);
    if (!taskId) return null;
    const { rows } = await this.pool.query('SELECT * FROM automation_tasks WHERE id = $1', [taskId]);
    return rows[0] ? enrichTask(rowToTask(rows[0] as Record<string, unknown>)) : null;
  }

  async pauseTask(idOrKey: string, sessionId?: string): Promise<{ ok: boolean; error?: string }> {
    const { rows } = await this.pool.query(
      `SELECT * FROM automation_tasks
       WHERE (id = $1 OR display_id = $1 OR task_key = $1) AND status = 'active'
       ${sessionId ? 'AND source_session_id = $2' : ''}
       LIMIT 1`,
      sessionId ? [idOrKey, sessionId] : [idOrKey],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'Active automation not found' };
    try {
      await this.stopBossJobs(row);
      await this.pool.query(
        `UPDATE automation_tasks SET status = 'paused', next_run_at = NULL, updated_at = NOW() WHERE id = $1`,
        [row['id']],
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async resumeTask(idOrKey: string, sessionId?: string): Promise<{ ok: boolean; error?: string; scheduleName?: string | null }> {
    const { rows } = await this.pool.query(
      `SELECT * FROM automation_tasks
       WHERE (id = $1 OR display_id = $1 OR task_key = $1) AND status = 'paused'
       ${sessionId ? 'AND source_session_id = $2' : ''}
       LIMIT 1`,
      sessionId ? [idOrKey, sessionId] : [idOrKey],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'Paused automation not found' };
    try {
      const { pgbossJobId, nextRunAt } = await this.scheduleBossJobs(row);
      await this.pool.query(
        `UPDATE automation_tasks SET status = 'active', pgboss_job_id = $2, next_run_at = $3, updated_at = NOW() WHERE id = $1`,
        [row['id'], pgbossJobId, nextRunAt],
      );
      return { ok: true, scheduleName: row['schedule_type'] === 'recurring' ? (row['pgboss_schedule_name'] as string | null) : null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async cancelTask(
    idOrKey: string,
    sessionId?: string,
    _opts?: { skipConfirmationClear?: boolean },
  ): Promise<{ ok: boolean; error?: string }> {
    const { rows } = await this.pool.query(
      `SELECT * FROM automation_tasks
       WHERE (id = $1 OR display_id = $1 OR task_key = $1) AND status IN ('active', 'paused')
       ${sessionId ? 'AND source_session_id = $2' : ''}
       LIMIT 1`,
      sessionId ? [idOrKey, sessionId] : [idOrKey],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'Automation not found' };

    try {
      await this.stopBossJobs(row);
      await this.pool.query(
        `UPDATE automation_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [row['id']],
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async deleteTask(idOrKey: string, sessionId?: string): Promise<{ ok: boolean; error?: string }> {
    const { rows } = await this.pool.query(
      `SELECT * FROM automation_tasks
       WHERE (id = $1 OR display_id = $1 OR task_key = $1) AND status IN ('completed', 'cancelled')
       ${sessionId ? 'AND source_session_id = $2' : ''}
       LIMIT 1`,
      sessionId ? [idOrKey, sessionId] : [idOrKey],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'Completed automation not found' };

    try {
      await this.pool.query('DELETE FROM automation_tasks WHERE id = $1', [row['id']]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async recordRun(taskId: string, status: 'success' | 'failed'): Promise<void> {
    const completedOnce = status === 'success';
    await this.pool.query(
      `UPDATE automation_tasks SET
        last_run_at = NOW(),
        last_run_status = $2,
        run_count = run_count + 1,
        updated_at = NOW(),
        status = CASE WHEN schedule_type = 'once' AND $3 THEN 'completed' ELSE status END
       WHERE id = $1`,
      [taskId, status, completedOnce],
    );
  }

  async publishNotification(input: {
    taskId?: string | null;
    kind: NotificationKind;
    title: string;
    body: string;
    channels: AutomationNotifyChannel[];
    payload?: Record<string, unknown>;
  }): Promise<NotificationRecord> {
    if (input.channels.length === 0) {
      return {
        id: '',
        taskId: input.taskId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body,
        payload: input.payload ?? null,
        channels: [],
        deliveryStatus: {},
        readAt: null,
        createdAt: new Date().toISOString(),
      };
    }

    const id = generateId();
    const deliveryStatus: Record<string, unknown> = {};
    const channels: AutomationNotifyChannel[] = input.channels;

    const { rows } = await this.pool.query(
      `INSERT INTO notifications (id, task_id, kind, title, body, payload, channels, delivery_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        id,
        input.taskId ?? null,
        input.kind,
        input.title,
        input.body,
        input.payload ? JSON.stringify(input.payload) : null,
        JSON.stringify(channels),
        JSON.stringify(deliveryStatus),
      ],
    );
    const notification = rowToNotification(rows[0] as Record<string, unknown>);
    broadcast({ type: 'notification_created', notification });
    try {
      getEngine().telemetry.emit({
        type: 'notification_created',
        notification,
      } as never);
    } catch { /* best-effort */ }
    return notification;
  }

  async listNotifications(limit = 50, unreadOnly = false): Promise<NotificationRecord[]> {
    const { rows } = unreadOnly
      ? await this.pool.query(
          `SELECT * FROM notifications WHERE dismissed_at IS NULL AND read_at IS NULL ORDER BY created_at DESC LIMIT $1`,
          [limit],
        )
      : await this.pool.query(
          `SELECT * FROM notifications WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT $1`,
          [limit],
        );
    return rows.map((r) => rowToNotification(r as Record<string, unknown>));
  }

  async markNotificationRead(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async dismissNotification(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE notifications SET dismissed_at = NOW(), read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND dismissed_at IS NULL`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async dismissAllNotifications(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE notifications SET dismissed_at = NOW(), read_at = COALESCE(read_at, NOW()) WHERE dismissed_at IS NULL`,
    );
    return result.rowCount ?? 0;
  }

  async unreadCount(): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL`,
    );
    return parseInt(rows[0]?.count ?? '0', 10) || 0;
  }
}

export async function deliverExternalNotifications(
  notification: NotificationRecord,
  task: AutomationTaskRecord | null,
  eng: {
    telegramBridge?: { sendMessage?: (chatId: number, text: string) => Promise<unknown> } | null;
    emailBridge?: { sendEmail?: (to: string, subject: string, body: string) => Promise<void> } | null;
    configManager?: { load: () => import('@agentx/shared').AgentXConfig };
  },
): Promise<Record<string, unknown>> {
  const delivery: Record<string, unknown> = { ...(notification.deliveryStatus ?? {}) };
  if (notification.channels.length === 0) return delivery;

  const cfg = eng.configManager?.load();
  const channelCfg = cfg?.channels;
  const text = `${notification.title}\n\n${notification.body}`;

  if (notification.channels.includes('telegram')) {
    try {
      const botToken = channelCfg?.telegram?.botToken ?? process.env['TELEGRAM_BOT_TOKEN'];
      const chatIdRaw = channelCfg?.telegram?.chatId
        ?? process.env['TELEGRAM_CHAT_ID']
        ?? getTelegramRuntimeHints().telegramChatId
        ?? undefined;
      const chatId = chatIdRaw ? Number(chatIdRaw) : null;
      const bridge = eng.telegramBridge as { sendMessage?: (chatId: number, text: string) => Promise<unknown> } | null | undefined;
      if (bridge?.sendMessage && chatId) {
        await bridge.sendMessage(chatId, text);
        delivery['telegram'] = 'sent';
      } else if (botToken && chatIdRaw) {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatIdRaw, text }),
          signal: AbortSignal.timeout(10000),
        });
        delivery['telegram'] = response.ok ? 'sent' : `api_error_${response.status}`;
      } else {
        delivery['telegram'] = 'skipped_no_config';
      }
    } catch (e) {
      delivery['telegram'] = e instanceof Error ? e.message : 'failed';
      getLogger().warn('AUTOMATION_NOTIFY', `Telegram delivery failed: ${delivery['telegram']}`);
    }
  }

  if (notification.channels.includes('slack')) {
    try {
      const webhookUrl = channelCfg?.slack?.webhookUrl ?? process.env['SLACK_WEBHOOK_URL'];
      if (!webhookUrl) {
        delivery['slack'] = 'skipped_no_config';
      } else {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(10000),
        });
        delivery['slack'] = response.ok ? 'sent' : `webhook_error_${response.status}`;
      }
    } catch (e) {
      delivery['slack'] = e instanceof Error ? e.message : 'failed';
      getLogger().warn('AUTOMATION_NOTIFY', `Slack delivery failed: ${delivery['slack']}`);
    }
  }

  if (notification.channels.includes('discord')) {
    try {
      const webhookUrl = channelCfg?.discord?.webhookUrl;
      if (!webhookUrl) {
        delivery['discord'] = 'skipped_no_config';
      } else {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text.slice(0, 2000) }),
          signal: AbortSignal.timeout(10000),
        });
        delivery['discord'] = response.ok ? 'sent' : `webhook_error_${response.status}`;
      }
    } catch (e) {
      delivery['discord'] = e instanceof Error ? e.message : 'failed';
      getLogger().warn('AUTOMATION_NOTIFY', `Discord delivery failed: ${delivery['discord']}`);
    }
  }

  if (notification.channels.includes('email')) {
    try {
      const emailCfg = channelCfg?.email;
      const to = emailCfg?.toAddress;
      const bridge = eng.emailBridge;
      if (bridge?.sendEmail && to) {
        await bridge.sendEmail(to, notification.title, notification.body);
        delivery['email'] = 'sent';
      } else if (emailCfg?.smtpHost && emailCfg.fromAddress && to) {
        delivery['email'] = 'skipped_no_bridge';
      } else {
        delivery['email'] = 'skipped_no_config';
      }
    } catch (e) {
      delivery['email'] = e instanceof Error ? e.message : 'failed';
      getLogger().warn('AUTOMATION_NOTIFY', `Email delivery failed: ${delivery['email']}`);
    }
  }

  if (notification.channels.includes('in_app')) {
    delivery['in_app'] = 'deferred_to_client';
  }

  if (notification.channels.includes('desktop')) {
    delivery['desktop'] = 'deferred_to_client';
  }

  if (task && notification.id) {
    // delivery status persisted by caller if needed
  }

  return delivery;
}
