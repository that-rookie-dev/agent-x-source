import type { Express } from 'express';
import {
  setAutomationBridge,
  buildAutomationNotifyQuestionnaire,
  getNotificationChannelStatus,
  notifyToolsForChannels,
  resolveAutomationNotifyChannels,
} from '@agentx/engine';
import { getLogger, isChannelSessionId, parseChannelBindingFromSessionId, type ChannelBindingId } from '@agentx/shared';
import { getEngine, getOrCreateAgent, ensureChannelAgent } from '../engine.js';
import { getTelegramRuntimeHints } from '../channels-sync.js';
import { startPgBoss, stopPgBoss } from './boss.js';
import { AutomationService, type AutomationDbPool } from './service.js';
import { startAutomationWorker, triggerAutomationRun } from './worker.js';

let service: AutomationService | null = null;
let stopWorker: (() => void) | null = null;

function resolveMessagingChannelForSession(
  eng: ReturnType<typeof getEngine>,
  sessionId: string,
): ChannelBindingId | null {
  const fromSession = parseChannelBindingFromSessionId(sessionId);
  if (fromSession) return fromSession;
  const bindings = eng.channelSessionBindings ?? {};
  for (const channel of Object.keys(bindings) as ChannelBindingId[]) {
    if (bindings[channel]?.sessionId === sessionId) return channel;
  }
  return null;
}

function resolveAgentForAutomationSession(sessionId: string) {
  const eng = getEngine();
  const channel = parseChannelBindingFromSessionId(sessionId);
  if (channel) return ensureChannelAgent(channel);
  const session = eng.sessionManager.getSessionById(sessionId);
  if (!session) return null;

  let agent = eng.agent;
  if (!agent || agent.currentSessionId !== sessionId) {
    agent = getOrCreateAgent(eng.configManager.load(), session);
  }
  return agent;
}

export function getAutomationService(): AutomationService | null {
  return service;
}

export async function initAutomation(connectionString: string, pool: AutomationDbPool): Promise<void> {
  await startPgBoss(connectionString);
  service = new AutomationService(pool);
  await service.backfillMissingDisplayIds();
  await service.backfillAutomationTaskOrigins();
  setAutomationBridge({
    ensureToolsApproved: async (sessionId, toolIds) => {
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) return { ok: false, error: 'Session not found' };
      const agent = resolveAgentForAutomationSession(sessionId);
      if (!agent) return { ok: false, error: 'Session not found' };
      return agent.ensureAutomationToolsApproved(toolIds);
    },
    promptNotifyChannels: async (sessionId) => {
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) return ['in_app'];
      const status = getNotificationChannelStatus(eng.configManager.load(), getTelegramRuntimeHints());
      const messagingChannel = resolveMessagingChannelForSession(eng, sessionId);
      const agent = resolveAgentForAutomationSession(sessionId);
      if (!agent) return ['in_app'];

      // Same delivery-channel questionnaire on web and messaging surfaces.
      const questionnaire = buildAutomationNotifyQuestionnaire(status);
      const answer = await agent.promptAutomationNotifyChannels(questionnaire);
      return resolveAutomationNotifyChannels({
        sourceChannel: messagingChannel ?? undefined,
        sourceSessionId: sessionId,
        status,
        questionnaireAnswer: answer,
      });
    },
    grantNotifyChannelTools: async (sessionId, channels) => {
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) return;
      const agent = resolveAgentForAutomationSession(sessionId);
      if (!agent) return;
      agent.grantAutomationNotifyTools(notifyToolsForChannels(channels));
    },
    registerTask: async (input) => {
      const result = await service!.registerTask(input);
      return result;
    },
    listTasks: (sessionId) => service!.listTasks(sessionId),
    cancelTask: (idOrKey, sessionId) => service!.cancelTask(idOrKey, sessionId),
  });
  stopWorker = await startAutomationWorker(service);
  getLogger().info('AUTOMATION', 'Automation subsystem initialized');
}

export async function shutdownAutomation(): Promise<void> {
  setAutomationBridge(null);
  stopWorker?.();
  stopWorker = null;
  service = null;
  await stopPgBoss();
}

export function registerAutomationRoutes(app: Express): void {
  app.get('/api/automation/tasks', async (_req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.json({ tasks: [] }); return; }
      const tasks = await svc.listTasks();
      res.json({ tasks });
    } catch (e) {
      getLogger().error('GET_API_AUTOMATION_TASKS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  app.get('/api/automation/tasks/:id/logs', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '80'), 10) || 80, 200);
      const logs = await svc.listRunLogs(req.params['id']!, limit);
      res.json({ logs });
    } catch (e) {
      getLogger().error('GET_API_AUTOMATION_TASKS_LOGS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'logs-failed' });
    }
  });

  app.get('/api/automation/tasks/:id', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const task = await svc.getTask(req.params['id']!);
      if (!task) { res.status(404).json({ error: 'not-found' }); return; }
      res.json({ task });
    } catch (e) {
      getLogger().error('GET_API_AUTOMATION_TASKS_ID', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'get-failed' });
    }
  });

  app.delete('/api/automation/tasks/:id', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const task = await svc.getTask(req.params['id']!);
      if (!task) { res.status(404).json({ error: 'not-found' }); return; }
      const result = task.status === 'completed' || task.status === 'cancelled'
        ? await svc.deleteTask(req.params['id']!)
        : await svc.cancelTask(req.params['id']!);
      if (!result.ok) { res.status(404).json({ error: result.error ?? 'remove-failed' }); return; }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('DELETE_API_AUTOMATION_TASKS_ID', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'remove-failed' });
    }
  });

  app.post('/api/automation/tasks/:id/pause', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const result = await svc.pauseTask(req.params['id']!);
      if (!result.ok) { res.status(404).json({ error: result.error ?? 'pause-failed' }); return; }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_AUTOMATION_PAUSE', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'pause-failed' });
    }
  });

  app.post('/api/automation/tasks/:id/resume', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const result = await svc.resumeTask(req.params['id']!);
      if (!result.ok) { res.status(404).json({ error: result.error ?? 'resume-failed' }); return; }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_AUTOMATION_RESUME', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'resume-failed' });
    }
  });

  app.post('/api/automation/tasks/:id/run', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const task = await svc.getTask(req.params['id']!);
      if (!task || task.status !== 'active') {
        res.status(404).json({ error: 'Active automation not found' });
        return;
      }
      void triggerAutomationRun(task.id, svc).catch((err: unknown) => {
        getLogger().error('AUTOMATION_MANUAL_RUN', err instanceof Error ? err : String(err));
      });
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_AUTOMATION_RUN', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'run-failed' });
    }
  });

  app.get('/api/notifications', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.json({ notifications: [], unreadCount: 0 }); return; }
      const unreadOnly = req.query['unread'] === '1' || req.query['unread'] === 'true';
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 200);
      const [notifications, unreadCount] = await Promise.all([
        svc.listNotifications(limit, unreadOnly),
        svc.unreadCount(),
      ]);
      res.json({ notifications, unreadCount });
    } catch (e) {
      getLogger().error('GET_API_NOTIFICATIONS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  app.post('/api/notifications/dismiss-all', async (_req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const count = await svc.dismissAllNotifications();
      res.json({ ok: true, count });
    } catch (e) {
      getLogger().error('POST_API_NOTIFICATIONS_DISMISS_ALL', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'dismiss-all-failed' });
    }
  });

  app.post('/api/notifications/:id/read', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const ok = await svc.markNotificationRead(req.params['id']!);
      res.json({ ok });
    } catch (e) {
      getLogger().error('POST_API_NOTIFICATIONS_READ', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'read-failed' });
    }
  });

  app.post('/api/notifications/:id/dismiss', async (req, res) => {
    try {
      const svc = getAutomationService();
      if (!svc) { res.status(503).json({ error: 'automation-unavailable' }); return; }
      const ok = await svc.dismissNotification(req.params['id']!);
      res.json({ ok });
    } catch (e) {
      getLogger().error('POST_API_NOTIFICATIONS_DISMISS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'dismiss-failed' });
    }
  });
}

export async function bootstrapAutomationFromEngine(): Promise<void> {
  const eng = getEngine();
  await eng.storageReady;
  const pool = eng.pgPool;
  if (!pool || !eng.connectionString) return;
  if (service) return;
  await initAutomation(eng.connectionString, pool as AutomationDbPool);
}
