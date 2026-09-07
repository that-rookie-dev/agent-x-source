import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getAgentProcessRegistry } from '@agentx/engine';

export function createProcessesRouter(): Router {
  const r = Router();

  r.get('/api/processes', (_req, res) => {
    try {
      const processes = getAgentProcessRegistry().getAll();
      res.json({ processes });
    } catch (e: unknown) {
      getLogger().error('GET_API_PROCESSES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  r.get('/api/processes/session/:sessionId', (req, res) => {
    try {
      const processes = getAgentProcessRegistry().getBySession(req.params['sessionId'] ?? '');
      res.json({ processes });
    } catch (e: unknown) {
      getLogger().error('GET_API_PROCESSES_SESSION', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'list-session-failed' });
    }
  });

  r.get('/api/processes/:pid/logs', (req, res) => {
    try {
      const pid = Number(req.params['pid']);
      if (!pid || pid <= 0) {
        res.status(400).json({ error: 'invalid-pid' });
        return;
      }
      const registry = getAgentProcessRegistry();
      const process = registry.get(pid);
      if (!process) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json({ pid, logTail: registry.getLogTail(pid) ?? '' });
    } catch (e: unknown) {
      getLogger().error('GET_API_PROCESS_LOGS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'logs-failed' });
    }
  });

  r.post('/api/processes/:pid/kill', (req, res) => {
    try {
      const pid = Number(req.params['pid']);
      if (!pid || pid <= 0) {
        res.status(400).json({ error: 'invalid-pid' });
        return;
      }

      const process = getAgentProcessRegistry().get(pid);
      if (!process) {
        res.status(404).json({ error: 'not-found' });
        return;
      }

      const sessionId = (req.body?.sessionId as string | undefined) ?? '';
      if (sessionId && process.sessionId !== sessionId) {
        res.status(403).json({ error: 'session-mismatch' });
        return;
      }

      const signal = (req.body?.signal as string | undefined) ?? 'SIGTERM';
      const ok = getAgentProcessRegistry().kill(pid, signal);
      res.json({ ok });
    } catch (e: unknown) {
      getLogger().error('POST_API_PROCESS_KILL', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'kill-failed' });
    }
  });

  return r;
}
