import type { Express, Request, Response } from 'express';
import { DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG, getLogger, type CapabilityStatus, type CapabilityKind } from '@agentx/shared';
import {
  CapabilityError,
  CapabilityNotFoundError,
  CapabilityValidationError,
  getRuntimeCapabilityManager,
} from '@agentx/engine';
import { getEngine, awaitStorageForApi, awaitSiManager } from './engine.js';
import { attachCapabilityEventBridge, registerCapabilityEventRoutes } from './capability-events.js';

async function managerOrEmpty(_res: Response) {
  await awaitStorageForApi();
  return (await awaitSiManager()) ?? getRuntimeCapabilityManager() ?? null;
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof CapabilityNotFoundError) {
    res.status(404).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof CapabilityValidationError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof CapabilityError) {
    res.status(409).json({ error: err.message, code: err.code });
    return;
  }
  getLogger().error('SI_API', err instanceof Error ? err : String(err));
  res.status(500).json({ error: err instanceof Error ? err.message : 'si-failed' });
}

export function registerCapabilityRoutes(app: Express): void {
  registerCapabilityEventRoutes(app);

  app.get('/api/capabilities', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ capabilities: [], stats: { total: 0, byStatus: {}, byKind: {} } });
        return;
      }
      const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
      const kind = typeof req.query['kind'] === 'string' ? req.query['kind'] : undefined;
      const origin = typeof req.query['origin'] === 'string' ? req.query['origin'] : undefined;
      const q = typeof req.query['q'] === 'string'
        ? req.query['q']
        : typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 200);
      const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0);
      let capabilities = q
        ? await mgr.store.searchCapabilities(q)
        : await mgr.store.getCapabilities(
            status as CapabilityStatus | undefined,
            kind as CapabilityKind | undefined,
            limit,
            offset,
          );
      if (origin) capabilities = capabilities.filter((c) => c.origin === origin);
      const stats = await mgr.store.getStats();
      res.json({ capabilities, stats });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/stats', async (_req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ total: 0, byStatus: {}, byKind: {}, tools: 0, skills: 0, pendingApprovals: 0 });
        return;
      }
      const stats = await mgr.store.getStats();
      const pending = (stats.byStatus['proposed'] ?? 0) + (stats.byStatus['in-trial'] ?? 0);
      res.json({
        ...stats,
        tools: await mgr.getActiveToolCount(),
        skills: await mgr.getActiveSkillCount(),
        pendingApprovals: pending,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/dashboard', async (_req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ stats: { total: 0, byStatus: {}, byKind: {} }, topTools: [], failedGens: 0, approvalRate: 0, pipeline: {}, recent: [] });
        return;
      }
      const stats = await mgr.store.getStats();
      const topTools = await mgr.store.getMostUsedTools(10);
      const recent = await mgr.store.getRecentAuditEvents(100);
      const proposed = recent.filter((e) => e.event === 'proposed').length;
      const registered = recent.filter((e) => e.event === 'registered').length;
      const rejected = recent.filter((e) => e.event === 'rejected').length;
      const failedGens = recent.filter((e) => e.event === 'sandbox-failed' || e.event === 'generation-completed' && e.details?.passed === false).length;
      const totalReviewed = proposed + rejected + registered;
      const approvalRate = totalReviewed ? Math.round((registered / totalReviewed) * 100) : 0;
      res.json({
        stats,
        topTools,
        failedGens,
        approvalRate,
        pipeline: {
          observed: stats.byStatus['observed'] ?? 0,
          proposed: stats.byStatus['proposed'] ?? 0,
          inTrial: stats.byStatus['in-trial'] ?? 0,
          registered: stats.byStatus['registered'] ?? 0,
          archived: stats.byStatus['archived'] ?? 0,
        },
        recent,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  const listObservations = async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ observations: [] });
        return;
      }
      const minConfidence = Number(req.query['minConfidence'] ?? 0) || 0;
      const minFrequency = Number(req.query['minFrequency'] ?? 0) || 0;
      res.json({ observations: await mgr.getObservations(minConfidence, minFrequency) });
    } catch (err) {
      sendError(res, err);
    }
  };
  app.get('/api/capabilities/observations', listObservations);
  app.get('/api/capabilities/observed', listObservations);

  app.post('/api/capabilities/observed/:id/acknowledge', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.acknowledgeObservation(req.params['id']!);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/observed/:id/ignore', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.ignoreObservation(req.params['id']!);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/observed/:id/generate', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const proposal = await mgr.generateCapability(req.params['id']!);
      if (!proposal) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json({ proposal });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/settings', async (_req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ settings: DEFAULT_SYNTHETIC_INTELLIGENCE_CONFIG });
        return;
      }
      res.json({ settings: mgr.getSettings() });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/capabilities/settings', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const eng = getEngine();
      const existing = eng.configManager.load();
      const patch = (req.body?.settings && typeof req.body.settings === 'object')
        ? req.body.settings
        : req.body;
      const next = {
        ...existing,
        syntheticIntelligence: {
          ...existing.syntheticIntelligence,
          ...patch,
        },
      };
      eng.configManager.save(next);
      mgr.setConfig(next);
      await mgr.applyRuntimeFlags();
      attachCapabilityEventBridge();
      res.json({ settings: mgr.getSettings() });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/consent', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const generationConsent = req.body?.generationConsent;
      if (!['unset', 'once', 'always', 'deny', 'deny-permanently'].includes(generationConsent)) {
        res.status(400).json({ error: 'generationConsent must be unset, once, always, deny, or deny-permanently' });
        return;
      }
      const eng = getEngine();
      const existing = eng.configManager.load();
      const next = {
        ...existing,
        syntheticIntelligence: {
          ...existing.syntheticIntelligence,
          generationConsent,
        },
      };
      eng.configManager.save(next);
      mgr.setConfig(next);
      res.json({ settings: mgr.getSettings() });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/metrics', async (_req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ metrics: { generationsTotal: 0, sandboxRunsTotal: 0 }, alerts: [], health: { enabled: false } });
        return;
      }
      const health = mgr.health();
      res.json({ metrics: health.metrics, alerts: health.alerts, health });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/generate', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const prompt = String(req.body?.prompt ?? '').trim();
      if (!prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }
      const proposal = await mgr.generateFromUserPrompt(prompt, {
        kind: req.body?.kind,
        language: req.body?.language,
        examples: req.body?.examples,
        actor: 'user',
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
      });
      res.json({ proposal });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/generate/clarify', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const prompt = String(req.body?.prompt ?? '').trim();
      if (!prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }
      res.json(await mgr.generator.clarifyUserPrompt(prompt));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/:id', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      const cap = await mgr.getCapability(req.params['id']!);
      if (!cap) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      const gates = await mgr.graduator.getGates(cap.id);
      const audit = await mgr.getAuditLog(cap.id);
      const usage = await mgr.getUsageReport(cap.id).catch(() => null);
      res.json({ capability: cap, gates, audit, usage });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/capabilities/:id', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const capability = await mgr.updateCapabilityContent(req.params['id']!, {
        name: req.body?.name,
        description: req.body?.description,
        sourceCode: req.body?.sourceCode,
        promptTemplate: req.body?.promptTemplate,
        content: req.body?.content,
      }, String(req.body?.actor ?? 'user'));
      res.json({ capability });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/:id/audit', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ audit: [] });
        return;
      }
      res.json({ audit: await mgr.getAuditLog(req.params['id']!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/:id/usage', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
          res.json({ usage: null });
        return;
      }
      res.json({ usage: await mgr.getUsageReport(req.params['id']!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/approve', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const gate = String(req.body?.gate ?? 'registration');
      const actor = String(req.body?.actor ?? 'user');
      if (gate === 'sandbox') await mgr.runSandbox(req.params['id']!);
      else if (gate === 'trial') await mgr.approveForTrial(req.params['id']!, actor);
      else await mgr.approveForRegistration(req.params['id']!, actor);
      res.json({ capability: await mgr.getCapability(req.params['id']!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/reject', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.rejectCapability(
        req.params['id']!,
        String(req.body?.actor ?? 'user'),
        String(req.body?.reason ?? ''),
        typeof req.body?.feedback === 'string' ? req.body.feedback : undefined,
      );
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/disable', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.disableCapability(req.params['id']!, String(req.body?.actor ?? 'user'));
      res.json({ capability: await mgr.getCapability(req.params['id']!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/enable', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.enableCapability(req.params['id']!, String(req.body?.actor ?? 'user'));
      res.json({ capability: await mgr.getCapability(req.params['id']!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/archive', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.archiveCapability(req.params['id']!, String(req.body?.actor ?? 'user'));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/rollback', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.rollbackCapability(req.params['id']!, String(req.body?.actor ?? 'user'));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/sandbox', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const result = await mgr.runSandbox(req.params['id']!);
      res.json({ result, capability: await mgr.getCapability(req.params['id']!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/test', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const cap = await mgr.getCapability(req.params['id']!);
      if (!cap || cap.kind !== 'tool') {
        res.status(400).json({ error: 'Only generated tools can be tested in the sandbox' });
        return;
      }
      const args = (req.body?.input && typeof req.body.input === 'object')
        ? req.body.input as Record<string, unknown>
        : (req.body?.args && typeof req.body.args === 'object') ? req.body.args as Record<string, unknown> : {};
      const result = await mgr.sandbox.runTool(cap.sourceCode, cap.language, args, cap.entryPoint);
      res.json({ result });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/capabilities/:id/test-cases', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.json({ testCases: [] });
        return;
      }
      res.json({ testCases: await mgr.listTestCases(req.params['id']!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/test-cases', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const name = String(req.body?.name ?? 'case');
      const input = (req.body?.input && typeof req.body.input === 'object') ? req.body.input as Record<string, unknown> : {};
      const testCase = await mgr.saveTestCase(req.params['id']!, name, input);
      res.json({ testCase });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/capabilities/:id/test-cases/:caseId', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const name = String(req.body?.name ?? '');
      const input = (req.body?.input && typeof req.body.input === 'object') ? req.body.input as Record<string, unknown> : {};
      const testCase = await mgr.updateTestCase(req.params['id']!, req.params['caseId']!, name, input);
      res.json({ testCase });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/capabilities/:id/test-cases/:caseId', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      await mgr.deleteTestCase(req.params['id']!, req.params['caseId']!);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/test-cases/:caseId/run', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const result = await mgr.runTestCase(req.params['id']!, req.params['caseId']!);
      res.json({ result });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/capabilities/:id/run-all-tests', async (req: Request, res: Response) => {
    try {
      const mgr = await managerOrEmpty(res);
      if (!mgr) {
        res.status(503).json({ error: 'storage-unavailable' });
        return;
      }
      const results = await mgr.runAllTestCases(req.params['id']!);
      res.json({ results });
    } catch (err) {
      sendError(res, err);
    }
  });
}
