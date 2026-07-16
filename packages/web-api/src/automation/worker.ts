import type { Agent } from '@agentx/engine';
import { automationRunSessionId, generateAxId, getLogger, sanitizeAutomationNotificationBody } from '@agentx/shared';
import type { TelemetryEvent } from '@agentx/shared';
import { effectiveAutomationNotifyChannels, getNotificationChannelStatus } from '@agentx/engine';
import { createAgent, getEngine, awaitEngineStorageReady, rewireTelegramChannelPermissions } from '../engine.js';
import { getTelegramRuntimeHints } from '../channels-sync.js';
import { getPgBoss, getAutomationQueueName } from './boss.js';
import { AutomationService, deliverExternalNotifications } from './service.js';
import { automationRunSessionMatchesTask, telemetryEventToPersistedLog } from './log-utils.js';

const AUTOMATION_INSTRUCTION_PREFIX = `[Scheduled automation]`;

function buildAutomationPrompt(title: string, instruction: string): string {
  return `${AUTOMATION_INSTRUCTION_PREFIX} ${title}

${instruction}

Execute this task fully using the tools and context you need.

IMPORTANT — your reply is delivered as a push/in-app notification. Respond with ONLY the final user-facing summary in markdown (headings, bullets, links). No preamble, no tool names, no internal notes, and do not repeat the task title or "[Scheduled automation]" header.

Do not call ask_clarification — use your best judgment. If you cannot complete the task, explain why briefly.

Do not call notify_* tools — delivery is handled automatically after your reply.`;
}

function resolveAutomationScopePath(
  task: { sourceSessionId: string | null },
  eng: ReturnType<typeof getEngine>,
): string {
  if (task.sourceSessionId) {
    const src = eng.sessionManager.getSessionById(task.sourceSessionId);
    if (src?.scopePath) return src.scopePath;
  }
  const active = eng.sessionManager.getActiveSession();
  if (active?.scopePath) return active.scopePath;
  return process.cwd();
}

async function restorePermissionSnapshot(agent: Agent, snapshot: Array<{ toolName: string; decision: string }> | null | undefined): Promise<void> {
  if (!snapshot?.length) return;
  const pm = agent.getToolExecutor()?.getPermissionManager();
  if (!pm) return;
  for (const entry of snapshot) {
    if (entry.decision !== 'allow_always') continue;
    if (entry.toolName === '*') pm.allowAll();
    else pm.grant(entry.toolName, 'allow_always');
  }
}

function emitAutomationTelemetry(
  type: 'automation_run_triggered' | 'automation_run_preparing' | 'automation_run_started' | 'automation_run_ended',
  taskId: string,
  extra?: Record<string, unknown>,
): void {
  const sessionId = automationRunSessionId(taskId);
  try {
    getEngine().telemetry.emit({
      type,
      taskId,
      sessionId,
      automationTaskId: taskId,
      timestamp: new Date().toISOString(),
      ...extra,
    } as unknown as TelemetryEvent);
  } catch { /* best-effort */ }
}

export async function triggerAutomationRun(taskId: string, service: AutomationService): Promise<void> {
  await runAutomationTurn(taskId, service);
}

async function waitUntilTargetRunTime(
  targetRunAt: string | undefined,
  taskId: string,
  runId: string,
  service: AutomationService,
): Promise<void> {
  if (!targetRunAt) return;
  const waitMs = new Date(targetRunAt).getTime() - Date.now();
  if (waitMs <= 0) return;
  void service.appendRunLog(taskId, runId, {
    level: 'sys',
    label: 'WAIT',
    detail: `Spinning up — ${Math.ceil(waitMs / 1000)}s until scheduled time`,
    eventType: 'automation_run_waiting',
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function runAutomationTurn(
  taskId: string,
  service: AutomationService,
  jobStartedAt?: string,
  targetRunAt?: string,
): Promise<void> {
  const triggeredAt = jobStartedAt ?? new Date().toISOString();
  const runId = generateAxId('run');

  emitAutomationTelemetry('automation_run_triggered', taskId, { runId, triggeredAt });
  emitAutomationTelemetry('automation_run_preparing', taskId, { runId, detail: 'Preparing worker…' });
  void service.clearRunLogs(taskId).catch(() => {});
  void service.appendRunLog(taskId, runId, {
    level: 'sys',
    label: 'TRIGGER',
    detail: 'Scheduled time reached',
    eventType: 'automation_run_triggered',
    ts: triggeredAt,
  }).catch(() => {});
  void service.appendRunLog(taskId, runId, {
    level: 'sys',
    label: 'PREP',
    detail: 'Preparing worker…',
    eventType: 'automation_run_preparing',
    ts: triggeredAt,
  }).catch(() => {});

  await awaitEngineStorageReady();
  const eng = getEngine();
  const task = await service.getTask(taskId);
  if (!task || task.status !== 'active') {
    getLogger().debug('AUTOMATION_WORKER', `Skip inactive/missing task ${taskId}`);
    return;
  }

  const resolvedTaskId = task.id;
  const cfg = eng.configManager.load();
  const sessionId = automationRunSessionId(resolvedTaskId);
  let runStatus: 'success' | 'failed' = 'success';

  const unsubTelemetry = eng.telemetry.onEvent((ev) => {
    const event = ev as { type?: string; timestamp?: string; [key: string]: unknown };
    if (!automationRunSessionMatchesTask(event, resolvedTaskId, sessionId)) return;
    const entry = telemetryEventToPersistedLog(event);
    if (!entry) return;
    void service.appendRunLog(resolvedTaskId, runId, entry).catch((err: unknown) => {
      getLogger().debug('AUTOMATION_LOG', err instanceof Error ? err.message : String(err));
    });
  });

  emitAutomationTelemetry('automation_run_started', resolvedTaskId, { title: task.title });

  const scopePath = resolveAutomationScopePath(task, eng);
  const session = eng.sessionManager.ensureAutomationRunSession(
    resolvedTaskId,
    cfg.provider.activeProvider as import('@agentx/shared').ProviderId,
    cfg.provider.activeModel,
    scopePath,
    task.title,
  );

  const agent = createAgent(cfg, session, {
    attachToEngine: false,
    automationRun: true,
    delegatedWorker: true,
  });
  await restorePermissionSnapshot(agent, task.permissionSnapshot as Array<{ toolName: string; decision: string }>);

  const runExecutor = agent.getToolExecutor();
  runExecutor?.setPermissionRequestHandler(async () => 'allow_once');

  agent.clearHistory();

  await waitUntilTargetRunTime(targetRunAt, resolvedTaskId, runId, service);

  const prompt = buildAutomationPrompt(task.title, task.instruction);
  try {
    const message = await agent.sendMessage(prompt, { sourceChannel: task.sourceChannel });
      const rawBody = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      const body = sanitizeAutomationNotificationBody(rawBody, { title: task.title }).slice(0, 4000);
      const channelStatus = getNotificationChannelStatus(cfg, getTelegramRuntimeHints());
      const deliveryChannels = effectiveAutomationNotifyChannels(task.notifyChannels, task, channelStatus);
      const notification = await service.publishNotification({
        taskId: task.id,
        kind: 'automation_success',
        title: `✓ ${task.title}`,
        body,
        channels: deliveryChannels,
        task,
        payload: { taskId: task.id, displayId: task.displayId, runSessionId: sessionId, runId },
      });
    await deliverExternalNotifications(notification, task, eng);
    await service.recordRun(resolvedTaskId, 'success');
    if (task.scheduleType === 'recurring') {
      const refreshed = await service.getTask(resolvedTaskId);
      if (refreshed) await service.scheduleNextRecurringRun(refreshed);
    }
    getLogger().info('AUTOMATION_WORKER', `Task ${task.displayId} (${resolvedTaskId}) completed`);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    void service.appendRunLog(resolvedTaskId, runId, {
      level: 'err',
      label: 'FAILED',
      detail: errMsg.slice(0, 500),
      eventType: 'automation_run_failed',
    }).catch(() => {});
    const channelStatus = getNotificationChannelStatus(cfg, getTelegramRuntimeHints());
    const deliveryChannels = effectiveAutomationNotifyChannels(task.notifyChannels, task, channelStatus);
    const notification = await service.publishNotification({
      taskId: task.id,
      kind: 'automation_failure',
      title: `✗ ${task.title}`,
      body: errMsg.slice(0, 2000),
      channels: deliveryChannels,
      task,
      payload: { taskId: task.id, displayId: task.displayId, error: errMsg, runSessionId: sessionId, runId },
    });
    await deliverExternalNotifications(notification, task, eng);
    await service.recordRun(resolvedTaskId, 'failed');
    runStatus = 'failed';
    getLogger().error('AUTOMATION_WORKER', `Task ${task.displayId} (${resolvedTaskId}) failed: ${errMsg}`);
    throw e;
  } finally {
    emitAutomationTelemetry('automation_run_ended', resolvedTaskId, { status: runStatus });
    unsubTelemetry();
    try {
      if (eng.agent && typeof (eng.agent as Agent).bindPermissionHandler === 'function') {
        (eng.agent as Agent).bindPermissionHandler();
      }
      rewireTelegramChannelPermissions(eng);
    } catch { /* best-effort */ }
    try {
      agent.sessionLogger?.close?.();
      agent.endSession();
    } catch { /* best-effort */ }
  }
}

const attachedQueues = new Set<string>();

async function attachQueueWorker(queueName: string, service: AutomationService): Promise<void> {
  if (attachedQueues.has(queueName)) return;
  const boss = getPgBoss();
  if (!boss) return;

  await boss.work<{ taskId: string; targetRunAt?: string }>(
    queueName,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const taskId = job.data?.taskId;
        if (!taskId) continue;
        const jobStartedAt = new Date().toISOString();
        await runAutomationTurn(taskId, service, jobStartedAt, job.data?.targetRunAt);
      }
    },
  );
  attachedQueues.add(queueName);
  getLogger().info('AUTOMATION_WORKER', `Listening on queue "${queueName}"`);
}

export async function ensureScheduleWorker(scheduleName: string, service: AutomationService): Promise<void> {
  await attachQueueWorker(scheduleName, service);
}

export async function bootstrapScheduleWorkers(service: AutomationService): Promise<void> {
  await service.migrateRecurringSchedulesToLeadTime();
}

export async function startAutomationWorker(service: AutomationService): Promise<() => void> {
  const boss = getPgBoss();
  if (!boss) return () => {};

  await attachQueueWorker(getAutomationQueueName(), service);
  await bootstrapScheduleWorkers(service);

  return () => {
    const instance = getPgBoss();
    if (!instance) return;
    for (const queueName of attachedQueues) {
      void instance.offWork(queueName).catch(() => {});
    }
    attachedQueues.clear();
  };
}
