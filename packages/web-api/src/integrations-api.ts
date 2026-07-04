import { Router, type Request, type Response } from 'express';
import type { ConnectIntegrationRequest, IntegrationHubSettings } from '@agentx/shared';
import { getEngine } from './engine.js';
import { validate, connectIntegrationSchema, mcpImportSchema, integrationSettingsSchema, integrationRunToolSchema } from './validation.js';
import { importMcpConfig, parseMcpImportConfig } from '@agentx/engine';

const router: import('express').Router = Router();

function syncIntegrationTools(): void {
  const eng = getEngine();
  eng.integrationHub.syncToToolkit(eng.toolkit.registry, eng.toolkit.executor);
}

router.get('/integrations/catalog', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({
    providers: eng.integrationHub.listCatalog({ includeCandidates: true }),
    settings: eng.integrationHub.getSettings(),
    stats: eng.integrationHub.getCatalogStats(),
  });
});

router.get('/integrations/connections', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({ connections: eng.integrationHub.listConnections() });
});

router.get('/integrations/audit', (req: Request, res: Response) => {
  const eng = getEngine();
  const limit = Number(req.query.limit ?? 100);
  res.json({ entries: eng.integrationHub.getAuditTail(Number.isFinite(limit) ? limit : 100) });
});

router.get('/integrations/analytics', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({ analytics: eng.integrationHub.getAnalytics() });
});

router.get('/integrations/settings', (_req: Request, res: Response) => {
  const eng = getEngine();
  res.json({ settings: eng.integrationHub.getSettings() });
});

router.post('/integrations/settings', validate(integrationSettingsSchema), (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const settings = req.body as IntegrationHubSettings;
    eng.integrationHub.updateSettings(settings);
    res.json({ settings: eng.integrationHub.getSettings() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/import', validate(mcpImportSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const config = parseMcpImportConfig(req.body);
    const result = await importMcpConfig(eng.integrationHub, config);
    syncIntegrationTools();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:providerId/connect', validate(connectIntegrationSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = req.params.providerId!;
    const body = req.body as ConnectIntegrationRequest;
    const connection = await eng.integrationHub.connect(providerId, body);
    syncIntegrationTools();
    res.json({ connection });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:providerId/oauth/start', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = req.params.providerId!;
    const remoteResourceUrl = typeof req.body?.remoteUrl === 'string' ? req.body.remoteUrl : undefined;
    const result = await eng.integrationHub.startOAuth(providerId, remoteResourceUrl);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/integrations/oauth/callback', async (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const errorParam = String(req.query.error ?? '');
  const acceptsHtml = (req.headers.accept ?? '').includes('text/html');

  if (errorParam) {
    const message = `OAuth denied: ${errorParam}`;
    if (acceptsHtml) {
      return res.status(400).send(oauthResultPage(false, message));
    }
    return res.status(400).json({ error: message });
  }

  if (!state || !code) {
    const message = 'Missing state or authorization code';
    if (acceptsHtml) return res.status(400).send(oauthResultPage(false, message));
    return res.status(400).json({ error: message });
  }

  try {
    const eng = getEngine();
    const connection = await eng.integrationHub.completeOAuth(state, code);
    syncIntegrationTools();
    if (acceptsHtml) {
      return res.send(oauthResultPage(true, `Connected to ${connection.displayName}`));
    }
    res.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (acceptsHtml) return res.status(400).send(oauthResultPage(false, message));
    res.status(400).json({ error: message });
  }
});

router.get('/integrations/:connectionId/resources', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const uri = String(req.query.uri ?? '');
    if (!uri) return res.status(400).json({ error: 'uri query parameter is required' });
    const resource = await eng.integrationHub.readIntegrationResource(connectionId, uri);
    res.json({ resource });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete('/integrations/:connectionId', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    await eng.integrationHub.disconnect(connectionId);
    syncIntegrationTools();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:connectionId/sync', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const connection = await eng.integrationHub.syncConnection(connectionId);
    syncIntegrationTools();
    res.json({ connection });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:connectionId/run-tool', validate(integrationRunToolSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const { toolName, args } = req.body as { toolName: string; args?: Record<string, unknown> };
    const result = await eng.integrationHub.runStoreTool(connectionId, toolName, args ?? {});
    syncIntegrationTools();
    res.json({ result });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/integrations/:connectionId/health', (req: Request, res: Response) => {
  const eng = getEngine();
  const connectionId = req.params.connectionId!;
  const health = eng.integrationHub.getHealth(connectionId);
  if (!health) {
    return res.status(404).json({ error: 'Connection not found' });
  }
  res.json({ health });
});

function oauthResultPage(success: boolean, message: string): string {
  const color = success ? '#22c55e' : '#ef4444';
  const payload = JSON.stringify({ type: 'agentx-integration-oauth', success, message });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agent-X Integrations</title></head>
<body style="font-family:system-ui;background:#0a0a0f;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:2rem;border:1px solid ${color}44;border-radius:12px;background:#111827">
<h1 style="color:${color};font-size:1.1rem;margin:0 0 1rem">Integration ${success ? 'Connected' : 'Failed'}</h1>
<p style="font-size:0.9rem;line-height:1.5;margin:0 0 1.5rem">${escapeHtml(message)}</p>
<p style="font-size:0.75rem;color:#9ca3af;margin:0">${success ? 'Returning to Agent-X…' : 'You can close this window and return to Agent-X Settings → Integrations.'}</p>
</div>
<script>
(function () {
  var payload = ${payload};
  try { window.opener && window.opener.postMessage(payload, '*'); } catch (e) {}
  try { new BroadcastChannel('agentx-integrations').postMessage(payload); } catch (e) {}
  if (${success ? 'true' : 'false'}) { setTimeout(function () { window.close(); }, 1200); }
})();
</script>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { router as integrationsRouter };
