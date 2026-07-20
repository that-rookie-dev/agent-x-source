import { Router, type Request, type Response } from 'express';
import type { ConnectIntegrationRequest, IntegrationHubSettings } from '@agentx/shared';
import { isChannelCoveredMcpIntegration } from '@agentx/shared';
import { getEngine } from './engine.js';
import { validate, connectIntegrationSchema, mcpImportSchema, integrationSettingsSchema, integrationRunToolSchema } from './validation.js';
import { importMcpConfig, parseMcpImportConfig } from '@agentx/engine';

const router: import('express').Router = Router();

function syncIntegrationTools(): void {
  const eng = getEngine();
  eng.integrationHub.syncToToolkit(eng.toolkit.registry, eng.toolkit.executor);
}

router.post('/integrations/maintain', async (_req: Request, res: Response) => {
  try {
    const eng = getEngine();
    await eng.integrationHub.maintainConnections();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'maintain-failed' });
  }
});

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
  res.json({
    connections: eng.integrationHub.listConnections().filter((c) => !isChannelCoveredMcpIntegration(c.providerId)),
  });
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

router.get('/integrations/notifications', (req: Request, res: Response) => {
  const eng = getEngine();
  const limit = Number(req.query.limit ?? 100);
  res.json({
    notifications: eng.integrationHub.listNotifications(Number.isFinite(limit) ? limit : 100),
    count: eng.integrationHub.notificationCount(),
  });
});

router.post('/integrations/notifications/:id/dismiss', (req: Request, res: Response) => {
  const eng = getEngine();
  const id = req.params.id!;
  const ok = eng.integrationHub.dismissNotification(id);
  if (!ok) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true, count: eng.integrationHub.notificationCount() });
});

router.post('/integrations/notifications/dismiss-all', (_req: Request, res: Response) => {
  const eng = getEngine();
  const dismissed = eng.integrationHub.dismissAllNotifications();
  res.json({ ok: true, dismissed, count: eng.integrationHub.notificationCount() });
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

router.post('/integrations/preflight', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = String(req.body?.providerId ?? '');
    const checks = Array.isArray(req.body?.checks) ? req.body.checks : undefined;
    const env = req.body?.env && typeof req.body.env === 'object' ? req.body.env as Record<string, string> : undefined;
    const folderPath = typeof req.body?.folderPath === 'string' ? req.body.folderPath : undefined;
    const remoteUrl = typeof req.body?.remoteUrl === 'string' ? req.body.remoteUrl : undefined;
    if (!providerId) return res.status(400).json({ error: 'providerId is required' });
    if (isChannelCoveredMcpIntegration(providerId)) {
      res.status(400).json({
        error: `${providerId} is configured under Settings → Channels, not MCP Store.`,
      });
      return;
    }
    const results = await eng.integrationHub.preflightProvider(providerId, checks, { env, folderPath, remoteUrl });
    res.json({ results });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:providerId/connect-test', validate(connectIntegrationSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = req.params.providerId!;
    const body = req.body as ConnectIntegrationRequest;
    const result = await eng.integrationHub.probeConnection(providerId, body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:providerId/connect', validate(connectIntegrationSchema), async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const providerId = req.params.providerId!;
    if (isChannelCoveredMcpIntegration(providerId)) {
      res.status(400).json({
        error: `${providerId} is configured under Settings → Channels. Remove the MCP connection and use Channels instead.`,
      });
      return;
    }
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

router.get('/integrations/oauth/redirect-uri', (_req: Request, res: Response) => {
  res.json({ redirectUri: getEngine().integrationHub.getOAuthRedirectUri() });
});

router.get('/integrations/oauth/result', (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const eng = getEngine();
  res.json({ result: eng.integrationHub.getOAuthResult(state) });
});

router.get('/integrations/oauth/callback', async (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const errorParam = String(req.query.error ?? '');
  const acceptsHtml = (req.headers.accept ?? '').includes('text/html');

  if (errorParam) {
    const message = errorParam === 'access_denied'
      ? 'OAuth denied: access was not granted.'
      : /redirect_uri/i.test(errorParam)
        ? `OAuth redirect URI mismatch (${errorParam}). Click Sign in again — Agent-X will register a fresh OAuth client.`
        : `OAuth denied: ${errorParam}`;
    if (state) getEngine().integrationHub.recordOAuthFailure(state, message);
    if (acceptsHtml) {
      return res.status(400).send(oauthResultPage(false, message));
    }
    return res.status(400).json({ error: message });
  }

  if (!state || !code) {
    const message = 'Missing state or authorization code';
    if (state) getEngine().integrationHub.recordOAuthFailure(state, message);
    if (acceptsHtml) return res.status(400).send(oauthResultPage(false, message));
    return res.status(400).json({ error: message });
  }

  try {
    const eng = getEngine();
    const connection = await eng.integrationHub.completeOAuth(state, code);
    syncIntegrationTools();
    if (acceptsHtml) {
      return res.send(oauthResultPage(true, `Connected to ${connection.displayName}`, {
        connectionId: connection.id,
        providerId: connection.providerId,
      }));
    }
    res.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getEngine().integrationHub.recordOAuthFailure(state, message);
    if (acceptsHtml) return res.status(400).send(oauthResultPage(false, message));
    res.status(400).json({ error: message });
  }
});

router.post('/integrations/:connectionId/mcp-auth', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const result = await eng.integrationHub.runMcpStdioAuth(connectionId);
    if (result.success) syncIntegrationTools();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/integrations/:connectionId/mcp-auth/start', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const result = await eng.integrationHub.startMcpStdioBrowserOAuth(connectionId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/integrations/mcp-auth/result', (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  const eng = getEngine();
  res.json({ result: eng.integrationHub.getMcpStdioOAuthResult(state) });
});

router.get('/integrations/mcp-auth/redirect-uri', (req: Request, res: Response) => {
  const providerId = String(req.query.providerId ?? 'gmail');
  const eng = getEngine();
  res.json({ redirectUri: eng.integrationHub.getMcpStdioOAuthRedirectUri(providerId) });
});

router.get('/integrations/:connectionId/mcp-auth/status', (req: Request, res: Response) => {
  const eng = getEngine();
  const connectionId = req.params.connectionId!;
  res.json(eng.integrationHub.getMcpStdioAuthStatus(connectionId));
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

router.post('/integrations/:connectionId/benchmark', async (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const connection = await eng.integrationHub.benchmarkConnection(connectionId);
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

router.get('/integrations/:connectionId/tools', (req: Request, res: Response) => {
  try {
    const eng = getEngine();
    const connectionId = req.params.connectionId!;
    const mapped = eng.integrationHub.getConnectionToolDefinitions(connectionId);
    if (!mapped) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    const connection = eng.integrationHub.listConnections().find((c) => c.id === connectionId);
    const benchmarks = new Map((connection?.toolBenchmarks ?? []).map((b) => [b.mcpName, b]));
    const cfg = eng.configManager.load();
    const permissions = cfg.permissions ?? {};
    const tools = mapped.map(({ mcpName, definition }) => {
      const defaultDecision = definition.riskLevel === 'low' ? 'allow' : definition.riskLevel === 'critical' ? 'deny' : 'ask';
      const bench = benchmarks.get(mcpName);
      return {
        mcpName,
        name: definition.name,
        description: definition.description,
        riskLevel: definition.riskLevel,
        defaultDecision: permissions[definition.id] ?? defaultDecision,
        benchmarkStatus: bench?.status,
        benchmarkError: bench?.error,
        benchmarkSkipReason: bench?.skipReason,
        lastTestedAt: bench?.testedAt,
        readonly: bench?.readonly ?? definition.riskLevel === 'low',
      };
    });
    res.json({
      tools,
      lastBenchmarkAt: connection?.lastBenchmarkAt,
      benchmarkSummary: connection?.benchmarkSummary,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

function oauthResultPage(
  success: boolean,
  message: string,
  meta?: { connectionId?: string; providerId?: string },
): string {
  const color = success ? '#22c55e' : '#ef4444';
  const payload = JSON.stringify({
    type: 'agentx-integration-oauth',
    success,
    message,
    ...(meta?.connectionId ? { connectionId: meta.connectionId } : {}),
    ...(meta?.providerId ? { providerId: meta.providerId } : {}),
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agent-X Integrations</title></head>
<body style="font-family:system-ui;background:#0a0a0f;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:2rem;border:1px solid ${color}44;border-radius:12px;background:#111827">
<h1 style="color:${color};font-size:1.1rem;margin:0 0 1rem">Integration ${success ? 'Connected' : 'Failed'}</h1>
<p style="font-size:0.9rem;line-height:1.5;margin:0 0 1.5rem">${escapeHtml(message)}</p>
<p style="font-size:0.75rem;color:#9ca3af;margin:0">${success ? 'Returning to Agent-X — tools will sync automatically…' : 'Close this window, return to the Agent-X setup wizard, and click "Sign in again" to retry.'}</p>
</div>
<script>
(function () {
  var payload = ${payload};
  try { window.opener && window.opener.postMessage(payload, '*'); } catch (e) { /* ignore */ }
  try { new BroadcastChannel('agentx-integrations').postMessage(payload); } catch (e) { /* ignore */ }
  if (${success ? 'true' : 'false'}) { setTimeout(function () { window.close(); }, 1200); }
})();
</script>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { router as integrationsRouter };

/** Google Gmail MCP OAuth callback — must match redirect URI registered in Google Cloud Console. */
export async function handleMcpStdioOAuthCallback(req: Request, res: Response): Promise<void> {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const errorParam = String(req.query.error ?? '');
  const acceptsHtml = (req.headers.accept ?? '').includes('text/html');

  if (errorParam) {
    const message = errorParam === 'access_denied'
      ? 'Google sign-in denied: access was not granted.'
      : /redirect_uri/i.test(errorParam)
        ? `OAuth redirect URI mismatch (${errorParam}). Add the callback URL shown in the Gmail setup wizard to Google Cloud Console.`
        : `Google sign-in denied: ${errorParam}`;
    if (state) getEngine().integrationHub.recordMcpStdioOAuthFailure(state, message);
    if (acceptsHtml) {
      res.status(400).send(oauthResultPage(false, message));
      return;
    }
    res.status(400).json({ error: message });
    return;
  }

  if (!state || !code) {
    const message = 'Missing state or authorization code';
    if (state) getEngine().integrationHub.recordMcpStdioOAuthFailure(state, message);
    if (acceptsHtml) {
      res.status(400).send(oauthResultPage(false, message));
      return;
    }
    res.status(400).json({ error: message });
    return;
  }

  try {
    const eng = getEngine();
    const connection = await eng.integrationHub.completeMcpStdioBrowserOAuth(state, code);
    syncIntegrationTools();
    if (acceptsHtml) {
      res.send(oauthResultPage(true, `Signed in to ${connection.displayName}`, {
        connectionId: connection.id,
        providerId: connection.providerId,
      }));
      return;
    }
    res.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getEngine().integrationHub.recordMcpStdioOAuthFailure(state, message);
    if (acceptsHtml) {
      res.status(400).send(oauthResultPage(false, message));
      return;
    }
    res.status(400).json({ error: message });
  }
}
