import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import type { ApiContext } from '../../services/ApiService.js';

export function createSubagentsRouter(ctx: ApiContext): Router {
  const r = Router();
  const service = ctx.api.getSubAgentService();

  r.get('/api/subagents', (_req, res) => {
    try {
      const tasks = service.listTasks();
      res.json({ tasks });
    } catch (e: unknown) {
      getLogger().error('GET_API_SUBAGENTS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  r.get('/api/subagents/:id', (req, res) => {
    try {
      const task = service.getTask(req.params['id']);
      if (!task) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json({ task });
    } catch (e: unknown) {
      getLogger().error('GET_API_SUBAGENT', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'get-failed' });
    }
  });

  r.get('/api/subagents/session/:sessionId', (req, res) => {
    try {
      const tasks = service.getTasksForSession(req.params['sessionId']);
      res.json({ tasks });
    } catch (e: unknown) {
      getLogger().error('GET_API_SUBAGENTS_SESSION', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-session-failed' });
    }
  });

  r.post('/api/subagents/:id/cancel', (req, res) => {
    try {
      const ok = service.cancelTask(req.params['id']);
      res.json({ ok });
    } catch (e: unknown) {
      getLogger().error('POST_API_SUBAGENT_CANCEL', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'cancel-failed' });
    }
  });

  return r;
}
