/**
 * Settings / DB route group (db status, provision, migrate, web-search, cache).
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createSettingsRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import { join } from 'node:path';
import { readdir, stat, rm } from 'node:fs/promises';
import { getLogger, getDataDir, getConfigDir, getCacheDir } from '@agentx/shared';
import type { AgentXConfig, PermissionRule } from '@agentx/shared';
import { getEngine, clearEngineDurable, setStorageProgressCallback, applyRuntimeSettings } from '../../engine.js';
import {
  validateWebSearchProvider,
  isWebSearchAvailableForChat,
  applyWebSearchConfigFromAgentConfig,
  healDatabaseStore,
  PostgresStorageAdapter,
  resetCatalogSeedInflight,
  runMigrations,
  MIGRATION_FILES,
  transferPostgresStorage,
  type MigrationResult,
} from '@agentx/engine';
import { REDACTED_SECRET } from '../../config-redaction.js';
import { startEmbeddedPostgresViaBridge } from '../../pg-lifecycle-bridge.js';
import type { DbExtensionCheck } from '../../db-extension-checks.js';
import { pathExists } from './shared.js';
import { bootstrapAutomationFromEngine } from '../../automation/index.js';

// ───── Module-local helpers (only used by settings/db routes) ─────

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let s = bytes;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(1)} ${units[i]}`;
}

const DB_STATUS_CACHE_MS = 60_000;
let dbStatusCache: { at: number; data: Record<string, unknown> } | null = null;

function invalidateDbStatusCache(): void {
  dbStatusCache = null;
}

function getPostgresBackend(eng: ReturnType<typeof getEngine>): 'embedded-postgres' | 'postgres' {
  try {
    const cfg = eng.pluginRegistry.getConfig('postgresql');
    const b = cfg['backend'];
    if (b === 'embedded-postgres' || b === 'postgres') return b;
  } catch { /* fall through */ }
  if (process.env['AGENTX_EMBEDDED_PG_ENABLED'] === '1') return 'embedded-postgres';
  return 'postgres';
}

async function buildProvisionStatus(eng: ReturnType<typeof getEngine>): Promise<Record<string, unknown>> {
  const store = eng.sessionManager?.getStorageAdapter();
  const pgConnected = !!(store && typeof store.isConnected === 'function' && store.isConnected());
  const backend = getPostgresBackend(eng);
  const pool = store?.getPool?.() ?? eng.pgPool;

  let vectorAvailable = false;
  let vectorError: string | null = null;
  let schemaVersion = 0;
  let migrationsApplied = 0;
  let migrationsUpToDate = false;
  let pendingMigrations = 0;

  if (pool && typeof pool.query === 'function' && typeof (pool as import('pg').Pool).connect === 'function') {
    const pgPool = pool as import('pg').Pool;
    try {
      const { runDbExtensionChecks } = await import('../../db-extension-checks.js');
      const client = await pgPool.connect();
      try {
        const ext = await runDbExtensionChecks(client);
        vectorAvailable = ext.vectorAvailable;
        vectorError = ext.vectorError ?? null;
      } finally {
        client.release();
      }
    } catch (e) {
      vectorError = e instanceof Error ? e.message : String(e);
    }

    try {
      const { rows } = await pgPool.query<{ version: number }>(
        `SELECT version FROM core_schema_migrations ORDER BY version ASC`,
      );
      migrationsApplied = rows.length;
      schemaVersion = rows.length > 0 ? Math.max(...rows.map((r) => r.version)) : 0;
      const appliedSet = new Set(rows.map((r) => r.version));
      const pending = MIGRATION_FILES.filter((m) => !appliedSet.has(m.version));
      pendingMigrations = pending.length;
      migrationsUpToDate = pending.length === 0;
    } catch {
      migrationsUpToDate = false;
    }
  }

  return {
    postgres: pgConnected,
    backend,
    vectorAvailable,
    vectorError,
    schemaVersion,
    migrationsApplied,
    migrationsUpToDate,
    pendingMigrations,
    timestamp: new Date().toISOString(),
  };
}

async function buildDbStatus(eng: ReturnType<typeof getEngine>): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (dbStatusCache && now - dbStatusCache.at < DB_STATUS_CACHE_MS) {
    return dbStatusCache.data;
  }
  const store = eng.sessionManager?.getStorageAdapter();
  const pgConnected = !!(store && typeof store.isConnected === 'function' && store.isConnected());
  let dbSizeBytes = 0;
  let tableCount = 0;
  const tables: Record<string, number> = {};
  let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  const checks: Array<{ table: string; rows: number; ok: boolean }> = [];
  let connectionString = '';

  try {
    const pgPool = store?.getPool?.() ?? eng.pgPool;
    if (pgPool && typeof pgPool.query === 'function') {
      const tabRows = await pgPool.query(
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename"
      );
      tableCount = tabRows.rows.length;
      for (const r of tabRows.rows as Array<{ tablename: string }>) {
        try {
          const cnt = await pgPool.query(`SELECT COUNT(*)::int as cnt FROM "${r.tablename}"`);
          tables[r.tablename] = (cnt.rows[0] as { cnt: number }).cnt;
          checks.push({ table: r.tablename, rows: (cnt.rows[0] as { cnt: number }).cnt, ok: true });
        } catch (e) {
          tables[r.tablename] = -1;
          checks.push({ table: r.tablename, rows: -1, ok: false });
          healthStatus = 'degraded';
        }
      }
      try {
        const sizeRes = await pgPool.query("SELECT pg_database_size(current_database()) as size");
        dbSizeBytes = (sizeRes.rows[0] as { size: number }).size;
      } catch (e) { /* db size not available */ }
      if (tableCount > 0) healthStatus = 'healthy';
      try {
        const connRes = await pgPool.query('SELECT current_database() as db, inet_server_addr() as host');
        const connRow = connRes.rows[0] as { host?: string; db?: string } | undefined;
        connectionString = `postgresql://${connRow?.['host'] ?? 'localhost'}/${connRow?.['db'] ?? 'agentx'}`;
      } catch { /* */ }
    }
  } catch (e) {
    healthStatus = 'unhealthy';
  }

  const dataDir = getDataDir();
  const configDir = getConfigDir();
  const cacheDir = getCacheDir();

  async function dirInfo(dir: string): Promise<{ path: string; sizeBytes: number; sizeFormatted: string }> {
    let sizeBytes = 0;
    try {
      if (await pathExists(dir)) {
        for (const f of await readdir(dir, { withFileTypes: true })) {
          const fp = join(dir, f.name);
          try { if (f.isFile()) sizeBytes += (await stat(fp)).size; } catch (e) { /* skip */ }
        }
      }
    } catch (e) { /* skip */ }
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let s = sizeBytes;
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
    return { path: dir, sizeBytes, sizeFormatted: `${s.toFixed(1)} ${units[i]}` };
  }

  const postgresBackend = getPostgresBackend(eng);

  const result = {
    backend: 'postgres',
    postgresBackend,
    connected: pgConnected,
    stats: {
      dbSizeBytes,
      dbSizeFormatted: dbSizeBytes > 0 ? formatSize(dbSizeBytes) : `${tableCount} tables`,
      tableCount,
      tables,
    },
    health: { status: healthStatus, checks },
    fileStorage: {
      config: await dirInfo(configDir),
      data: await dirInfo(dataDir),
      cache: await dirInfo(cacheDir),
    },
    postgres: {
      configured: true,
      connectionString,
    },
  };
  dbStatusCache = { at: Date.now(), data: result };
  return result;
}

async function persistPostgresBackend(
  resolvedBackend: 'embedded-postgres' | 'postgres',
  connectionString: string,
): Promise<void> {
  process.env['AGENTX_POSTGRES_CONNECTION_STRING'] = connectionString;
  process.env['AGENTX_EMBEDDED_PG_ENABLED'] = resolvedBackend === 'embedded-postgres' ? '1' : '0';

  const eng = getEngine();
  const { getBuiltinPlugin } = await import('@agentx/engine');

  if (!eng.pluginRegistry.isInstalled('postgresql')) {
    const entry = getBuiltinPlugin('postgresql');
    if (entry) eng.pluginRegistry.install(entry);
  }
  if (!eng.pluginRegistry.isEnabled('postgresql')) {
    eng.pluginRegistry.enable('postgresql');
  }
  eng.pluginRegistry.updateConfig('postgresql', {
    backend: resolvedBackend,
    connectionString,
    autoMigrate: true,
    poolSize: 5,
  });

  // Must drain the write queue before discarding the engine — otherwise
  // pending crew INSERTs are lost while sessions may already be committed.
  await clearEngineDurable();
  invalidateDbStatusCache();
}

export function createSettingsRouter(): Router {
  const r = Router();

  r.get('/api/sessions/db-status', async (_req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter();
      const info = store?.getInfo?.() ?? { dbMode: 'postgres', sessionCount: 0, filesystemRecovered: 0, schemaVersion: 0 };
      res.json({ ...info, dbMode: 'postgres' });
    } catch (e) {
      res.json({ dbMode: 'postgres', sessionCount: 0, filesystemRecovered: 0, schemaVersion: 0 });
    }
  });

  r.get('/api/settings/db', async (_req, res) => {
    try {
      const eng = getEngine();
      res.json(await buildDbStatus(eng));
    } catch (e: unknown) {
      getLogger().error('GET_API_SETTINGS_DB', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'settings-db-failed' });
    }
  });

  r.get('/api/settings/db/provision-status', async (_req, res) => {
    try {
      const eng = getEngine();
      res.json(await buildProvisionStatus(eng));
    } catch (e: unknown) {
      getLogger().error('GET_API_SETTINGS_DB_PROVISION_STATUS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'provision-status-failed' });
    }
  });

  function permissionsToRules(permissions: Record<string, 'allow' | 'deny' | 'ask'>): PermissionRule[] {
    return Object.entries(permissions).map(([key, effect]) => {
      const colonIdx = key.indexOf(':');
      if (colonIdx >= 0) {
        return { action: key.slice(0, colonIdx), pattern: key.slice(colonIdx + 1), effect };
      }
      return { action: `tool:${key}`, pattern: '*', effect };
    });
  }

  r.get('/api/settings/permissions', (_req, res) => {
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      res.json({ permissions: cfg.permissions ?? {} });
    } catch (e: unknown) {
      getLogger().error('GET_API_SETTINGS_PERMISSIONS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'permissions-load-failed' });
    }
  });

  r.get('/api/settings/permissions/tools', (_req, res) => {
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      const overrides = cfg.permissions ?? {};
      const nativeTools = eng.toolkit.registry.list().map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        riskLevel: t.riskLevel,
        defaultDecision: (t.riskLevel === 'low' ? 'allow' : 'ask') as 'allow' | 'ask',
        currentDecision: (overrides[t.id] ?? (t.riskLevel === 'low' ? 'allow' : 'ask')) as 'allow' | 'deny' | 'ask',
        overridden: t.id in overrides,
        source: 'native' as const,
      }));
      const mcpTools: typeof nativeTools = [];
      for (const { providerId, tools } of eng.integrationHub.getAllConnectedToolDefinitions()) {
        const provider = eng.integrationHub.getProvider(providerId);
        for (const mapped of tools) {
          const t = mapped.definition;
          const defaultDecision = t.riskLevel === 'low' ? 'allow' : t.riskLevel === 'critical' ? 'deny' : 'ask';
          mcpTools.push({
            id: t.id,
            name: t.name,
            description: t.description,
            category: 'integrations' as const,
            riskLevel: t.riskLevel,
            defaultDecision: defaultDecision as 'allow' | 'ask' | 'deny',
            currentDecision: (overrides[t.id] ?? defaultDecision) as 'allow' | 'deny' | 'ask',
            overridden: t.id in overrides,
            source: 'mcp' as const,
            providerId,
            providerName: provider?.name ?? providerId,
          } as unknown as typeof nativeTools[number]);
        }
      }
      const tools = [...nativeTools, ...mcpTools];
      res.json({ tools, permissions: overrides });
    } catch (e: unknown) {
      getLogger().error('GET_API_SETTINGS_PERMISSIONS_TOOLS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'permissions-tools-load-failed' });
    }
  });

  r.post('/api/settings/permissions', (req, res) => {
    try {
      const { permissions } = req.body as { permissions?: Record<string, unknown> };
      if (!permissions || typeof permissions !== 'object') {
        res.status(400).json({ error: 'permissions object is required' }); return;
      }
      const validatedPermissions: Record<string, 'allow' | 'deny' | 'ask'> = {};
      for (const [key, value] of Object.entries(permissions)) {
        if (typeof value !== 'string' || !['allow', 'deny', 'ask'].includes(value)) {
          res.status(400).json({ error: `invalid effect for ${key}: must be 'allow', 'deny', or 'ask'` }); return;
        }
        validatedPermissions[key] = value as 'allow' | 'deny' | 'ask';
      }
      const eng = getEngine();
      const current = eng.configManager.load();
      const merged: AgentXConfig = { ...current, permissions: validatedPermissions };
      eng.configManager.save(merged);
      eng.configManager.reload();
      applyRuntimeSettings(merged);
      const executor = eng.toolkit?.executor;
      if (executor && typeof (executor as { setUserConfigRules?: (rules: PermissionRule[]) => void }).setUserConfigRules === 'function') {
        (executor as { setUserConfigRules: (rules: PermissionRule[]) => void }).setUserConfigRules(permissionsToRules(validatedPermissions));
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_SETTINGS_PERMISSIONS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'permissions-save-failed' });
    }
  });

  r.get('/api/settings/web-search/status', async (_req, res) => {
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      applyWebSearchConfigFromAgentConfig(cfg);
      const status = isWebSearchAvailableForChat(cfg);
      res.json(status);
    } catch (e: unknown) {
      getLogger().error('GET_API_SETTINGS_WEB_SEARCH_STATUS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'web-search-status-failed' });
    }
  });

  r.post('/api/settings/web-search/test', async (req, res) => {
    try {
      const provider = req.body?.provider as string;
      if (provider !== 'brave' && provider !== 'exa' && provider !== 'tavily') {
        res.status(400).json({ ok: false, error: 'provider must be brave, exa, or tavily' });
        return;
      }
      let apiKey = String(req.body?.apiKey ?? '').trim();
      if (!apiKey || apiKey === REDACTED_SECRET) {
        try {
          const cfg = getEngine().configManager.load();
          apiKey = cfg.tools?.webSearch?.[provider]?.apiKey?.trim() ?? '';
        } catch {
          apiKey = '';
        }
      }
      if (!apiKey) {
        res.status(400).json({ ok: false, error: 'No API key configured for this search provider' });
        return;
      }
      const result = await validateWebSearchProvider(provider, apiKey);
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : 'web-search-test-failed',
      });
    }
  });

  r.put('/api/settings/db', async (req, res) => {
    try {
      const { backend, postgres } = req.body || {};
      const resolvedBackend = backend === 'embedded-postgres' ? 'embedded-postgres' : 'postgres';
      getLogger().info('SETTINGS_DB_UPDATE', `PostgreSQL connection update requested (backend=${resolvedBackend})`);

      let connectionString = postgres?.connectionString as string | undefined;

      if (resolvedBackend === 'embedded-postgres') {
        connectionString = process.env['AGENTX_POSTGRES_CONNECTION_STRING'];
        if (!connectionString) {
          // First-run deferred boot: start embedded PG on demand (same process as desktop/server).
          try {
            connectionString = await startEmbeddedPostgresViaBridge((line) => {
              getLogger().info('PG_PROVISION', line);
            });
          } catch (e: unknown) {
            res.status(400).json({
              ok: false,
              error: e instanceof Error ? e.message : 'Embedded PostgreSQL failed to start',
            });
            return;
          }
        }
      }

      if (connectionString) {
        const { PostgresStorageAdapter } = await import('@agentx/engine');
        const test = await PostgresStorageAdapter.testConnection(connectionString);
        if (!test.ok) {
          res.status(400).json({ ok: false, error: test.error ?? 'PostgreSQL connection failed' });
          return;
        }

        await persistPostgresBackend(resolvedBackend, connectionString);
      }

      // Re-bootstrap automation in case it wasn't initialized at startup
      // (e.g. first-run deferred config). Safe to call multiple times —
      // it's a no-op if the service is already running.
      try {
        await bootstrapAutomationFromEngine();
      } catch (e) {
        getLogger().warn('SETTINGS_DB_UPDATE', `Automation bootstrap failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      res.json({ ok: true, backend: resolvedBackend });
    } catch (e: unknown) {
      getLogger().error('PUT_API_SETTINGS_DB', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'settings-db-update-failed' });
    }
  });

  r.post('/api/settings/db/provision', async (req, res) => {
    const { backend, postgres } = req.body || {};
    const resolvedBackend = backend === 'embedded-postgres' ? 'embedded-postgres' : 'postgres';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Flush headers immediately so the wizard sees progress before long work starts.
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as { flushHeaders: () => void }).flushHeaders();
    }

    let eventId = 0;
    let clientDisconnected = false;
    // IMPORTANT: use res 'close', not req 'close'.
    // For POST + SSE, req emits 'close' when the request *body* is fully consumed —
    // that happens immediately after Express parses JSON, which would silence every
    // subsequent progress event (exactly the "stuck after Loading storage adapter" bug).
    res.on('close', () => {
      clientDisconnected = true;
      getLogger().warn('PG_PROVISION', 'Client disconnected during provision — server setup may continue in background', {
        backend: resolvedBackend,
      });
    });

    const flush = () => {
      const r = res as { flush?: () => void };
      if (typeof r.flush === 'function') {
        try { r.flush(); } catch { /* ignore */ }
      }
    };

    const send = (event: string, data: unknown) => {
      if (clientDisconnected || res.writableEnded || res.destroyed) return;
      try {
        res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        eventId += 1;
        flush();
      } catch { /* client closed */ }
    };

    const log = (line: string) => {
      getLogger().info('PG_PROVISION', line);
      send('log', { line, ts: new Date().toISOString() });
    };

    const logError = (phase: string, e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      getLogger().error('PG_PROVISION', {
        phase,
        error: message,
        stack,
        backend: resolvedBackend,
        clientDisconnected,
      });
      send('log', { line: `[ERROR] ${phase}: ${message}`, ts: new Date().toISOString() });
    };

    // Keepalive so proxies / browsers don't treat a quiet stream as dead during slow cloud migrate/seed.
    let heartbeatTicks = 0;
    const heartbeat = setInterval(() => {
      if (clientDisconnected || res.writableEnded || res.destroyed) return;
      heartbeatTicks += 1;
      send('status', { phase: 'working', backend: resolvedBackend, tick: heartbeatTicks });
      if (heartbeatTicks % 5 === 0) {
        log(`Still working… (${heartbeatTicks * 2}s elapsed — schema migrate / catalog seed can take a few minutes on cloud)`);
      }
    }, 2_000);
    if (typeof heartbeat === 'object' && heartbeat && 'unref' in heartbeat) {
      (heartbeat as NodeJS.Timeout).unref();
    }

    try {
      resetCatalogSeedInflight();
      send('status', { phase: 'starting', backend: resolvedBackend });
      log(`Provisioning ${resolvedBackend === 'embedded-postgres' ? 'embedded' : 'cloud'} PostgreSQL…`);

      let connectionString = typeof postgres?.connectionString === 'string'
        ? postgres.connectionString.trim()
        : '';

      if (resolvedBackend === 'embedded-postgres') {
        log('Starting bundled PostgreSQL (initdb / extensions may take a minute on first run)…');
        try {
          connectionString = await startEmbeddedPostgresViaBridge((line) => log(line));
        } catch (e) {
          logError('embedded-postgres-start', e);
          throw e;
        }
      } else {
        if (!connectionString) {
          send('error', { error: 'Connection string is required for cloud PostgreSQL' });
          res.end();
          return;
        }
        log('Testing remote PostgreSQL connection (15s timeout)…');
      }

      // Use the already-loaded adapter — avoid a second dynamic import that can stall first-load.
      log('Opening PostgreSQL connection…');
      let test: Awaited<ReturnType<typeof PostgresStorageAdapter.testConnection>>;
      try {
        test = await PostgresStorageAdapter.testConnection(connectionString);
      } catch (e) {
        logError('connection-test', e);
        throw e;
      }
      if (!test.ok) {
        const err = test.error ?? 'PostgreSQL connection failed';
        getLogger().error('PG_PROVISION', { phase: 'connection-test', error: err, backend: resolvedBackend });
        send('error', { error: err });
        res.end();
        return;
      }
      log(test.version ? `Connected: ${test.version}` : 'Connection OK');

      log('Saving storage configuration…');
      setStorageProgressCallback((line) => log(line));
      try {
        try {
          await persistPostgresBackend(resolvedBackend, connectionString);
        } catch (e) {
          logError('persist-config', e);
          throw e;
        }
        log('Reconnecting engine with new storage backend…');
        log('Applying schema migrations and seeding Crew Hub catalog (progress updates every few seconds)…');
        const eng = getEngine();
        const storageReadyTimeoutMs = 20 * 60 * 1000;
        try {
          await Promise.race([
            eng.storageReady,
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(
                  `Storage setup timed out after ${Math.round(storageReadyTimeoutMs / 60000)} minutes. `
                  + 'Check PostgreSQL connectivity, pgvector extension, and debug logs.',
                ));
              }, storageReadyTimeoutMs);
            }),
          ]);
        } catch (e) {
          logError('engine-storage-ready', e);
          throw e;
        }
      } finally {
        setStorageProgressCallback(undefined);
      }

      if (clientDisconnected) {
        getLogger().info('PG_PROVISION', 'Provision finished after client disconnect', { backend: resolvedBackend });
        return;
      }
      log('Storage provision complete.');

      // Now that storage is ready and config is saved, bootstrap the automation
      // service. This is critical for the first-run setup wizard flow: at initial
      // startup the config isn't ready yet so bootstrapAutomationFromEngine() is
      // a no-op. We retry here once the wizard has provisioned PostgreSQL.
      try {
        log('Initializing automation service…');
        await bootstrapAutomationFromEngine();
      } catch (e) {
        logError('automation-bootstrap', e);
      }

      send('complete', { ok: true, backend: resolvedBackend });
      res.end();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'provision-failed';
      logError('provision', e);
      send('error', { error: message });
      res.end();
    } finally {
      clearInterval(heartbeat);
    }
  });

  r.post('/api/settings/db/test', async (req, res) => {
    try {
      const { connectionString } = req.body || {};
      if (!connectionString) {
        res.json({ ok: false, error: 'No connection string provided' });
        return;
      }
      const { Pool } = await import('pg');
      const { runDbExtensionChecks } = await import('../../db-extension-checks.js');
      const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000 });
      const client = await pool.connect();
      try {
        const result = await client.query('SELECT version() as version');
        const pgVersion = result.rows[0]?.['version'] as string;
        const ext = await runDbExtensionChecks(client);

        const blocking = ext.checks.some((c: DbExtensionCheck) => c.status === 'fail');
        getLogger().info('SETTINGS_DB_TEST', `PostgreSQL connection ${blocking ? 'partial' : 'successful'}: ${pgVersion}`);

        res.json({
          ok: !blocking,
          version: pgVersion || 'connected',
          checks: ext.checks,
          vectorAvailable: ext.vectorAvailable,
          vectorError: ext.vectorError,
          extensionsCreated: ext.extensionsCreated,
          error: blocking
            ? ext.checks.find((c: DbExtensionCheck) => c.status === 'fail')?.message ?? 'Required database extensions are missing'
            : undefined,
        });
      } finally {
        try { client.release(); } catch { /* ignore */ }
        await pool.end().catch(() => {});
      }
    } catch (e: unknown) {
      getLogger().error('POST_API_SETTINGS_DB_TEST', e instanceof Error ? e : String(e));
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'connection-failed' });
    }
  });

  r.post('/api/settings/db/migrate', async (_req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager?.getStorageAdapter() as PostgresStorageAdapter | undefined;
      if (!store || typeof store.connect !== 'function') {
        res.status(500).json({ ok: false, error: 'PostgreSQL storage not initialized' });
        return;
      }
      const started = Date.now();
      await store.connect();
      const durationMs = Date.now() - started;
      invalidateDbStatusCache();
      res.json({ ok: true, migrated: {}, durationMs });
    } catch (e: unknown) {
      getLogger().error('POST_API_SETTINGS_DB_MIGRATE', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'settings-db-migrate-failed' });
    }
  });

  r.post('/api/settings/db/transfer', async (req, res) => {
    const { targetBackend, connectionString: rawConnectionString } = req.body || {};
    const resolvedTarget = targetBackend === 'embedded-postgres' ? 'embedded-postgres' : 'postgres';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as { flushHeaders: () => void }).flushHeaders();
    }

    let eventId = 0;
    let clientDisconnected = false;
    res.on('close', () => { clientDisconnected = true; });

    const flush = () => {
      const r = res as { flush?: () => void };
      if (typeof r.flush === 'function') {
        try { r.flush(); } catch { /* ignore */ }
      }
    };

    const send = (event: string, data: unknown) => {
      if (clientDisconnected || res.writableEnded || res.destroyed) return;
      try {
        res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        eventId += 1;
        flush();
      } catch { /* client closed */ }
    };

    const log = (line: string) => {
      getLogger().info('PG_TRANSFER', line);
      send('log', { line, ts: new Date().toISOString() });
    };

    const logError = (phase: string, e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().error('PG_TRANSFER', { phase, error: message, stack: e instanceof Error ? e.stack : undefined });
      send('log', { line: `[ERROR] ${phase}: ${message}`, ts: new Date().toISOString() });
    };

    try {
      const eng = getEngine();
      const currentBackend = getPostgresBackend(eng);
      if (currentBackend === resolvedTarget) {
        send('error', { error: `Already using ${resolvedTarget === 'embedded-postgres' ? 'embedded' : 'cloud'} PostgreSQL.` });
        res.end();
        return;
      }

      const store = eng.sessionManager?.getStorageAdapter() as PostgresStorageAdapter | undefined;
      const sourcePool = store?.getPool?.() ?? eng.pgPool;
      if (!sourcePool || typeof sourcePool.query !== 'function') {
        send('error', { error: 'Source PostgreSQL is not connected.' });
        res.end();
        return;
      }

      send('status', { phase: 'starting', targetBackend: resolvedTarget, sourceBackend: currentBackend });
      log(`Migrating storage from ${currentBackend === 'embedded-postgres' ? 'embedded' : 'cloud'} to ${resolvedTarget === 'embedded-postgres' ? 'embedded' : 'cloud'} PostgreSQL…`);

      let destinationConnectionString = typeof rawConnectionString === 'string' ? rawConnectionString.trim() : '';

      if (resolvedTarget === 'embedded-postgres') {
        log('Starting bundled embedded PostgreSQL…');
        try {
          destinationConnectionString = await startEmbeddedPostgresViaBridge((line) => log(line));
        } catch (e) {
          logError('embedded-postgres-start', e);
          throw e;
        }
      } else if (!destinationConnectionString) {
        send('error', { error: 'Connection string is required for cloud PostgreSQL.' });
        res.end();
        return;
      }

      log('Testing destination PostgreSQL connection…');
      const test = await PostgresStorageAdapter.testConnection(destinationConnectionString);
      if (!test.ok) {
        send('error', { error: test.error ?? 'Destination connection failed' });
        res.end();
        return;
      }
      log(test.version ? `Destination connected: ${test.version}` : 'Destination connection OK');

      log('Copying data to destination (schema update + upsert)…');
      const transferResult = await transferPostgresStorage({
        sourcePool,
        destinationConnectionString,
        progress: log,
      });

      log('Updating local storage configuration…');
      await persistPostgresBackend(resolvedTarget, destinationConnectionString);

      log('Reconnecting engine with new storage backend…');
      setStorageProgressCallback((line) => log(line));
      try {
        const storageReadyTimeoutMs = 20 * 60 * 1000;
        await Promise.race([
          getEngine().storageReady,
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Storage reconnect timed out after ${Math.round(storageReadyTimeoutMs / 60000)} minutes.`));
            }, storageReadyTimeoutMs);
          }),
        ]);
      } finally {
        setStorageProgressCallback(undefined);
      }

      if (clientDisconnected) return;

      log('Storage migration complete.');
      send('complete', {
        ok: true,
        targetBackend: resolvedTarget,
        tablesCopied: transferResult.tablesCopied,
        totalRows: transferResult.totalRows,
        restartRequired: true,
      });
      res.end();
    } catch (e: unknown) {
      logError('transfer', e);
      send('error', { error: e instanceof Error ? e.message : 'storage-transfer-failed' });
      res.end();
    }
  });

  // ═══ Migration status & upgrade ═══
  // Returns which schema migrations are applied and which are pending.
  // Used by the DockingStation upgrade UI to show pending migrations.
  r.get('/api/migrations/status', async (_req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager?.getStorageAdapter() as PostgresStorageAdapter | undefined;
      if (!store) {
        res.status(503).json({ error: 'Storage not initialized' });
        return;
      }
      const pool = store.getPool();
      if (!pool) {
        res.status(503).json({ error: 'Database pool not available' });
        return;
      }

      // Query applied migrations from the tracking table
      const { rows } = await pool.query<{ version: number; name: string; applied_at: string }>(
        `SELECT version, name, applied_at FROM core_schema_migrations ORDER BY version ASC`,
      );
      const appliedSet = new Set(rows.map((r) => r.version));

      const applied = rows.map((r) => ({
        version: r.version,
        name: r.name,
        appliedAt: r.applied_at,
      }));
      const pending = MIGRATION_FILES
        .filter((m) => !appliedSet.has(m.version))
        .map((m) => ({
          version: m.version,
          name: m.name,
        }));

      const currentVersion = MIGRATION_FILES.length > 0
        ? Math.max(...MIGRATION_FILES.map((m) => m.version))
        : 0;
      const appliedVersion = rows.length > 0
        ? Math.max(...rows.map((r) => r.version))
        : 0;

      res.json({
        applied,
        pending,
        currentVersion,
        appliedVersion,
        totalMigrations: MIGRATION_FILES.length,
        upToDate: pending.length === 0,
      });
    } catch (e: unknown) {
      getLogger().error('GET_API_MIGRATIONS_STATUS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'migration-status-failed' });
    }
  });

  // Runs all pending schema migrations. Returns the result with details
  // about which migrations were applied.
  r.post('/api/migrations/run', async (_req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager?.getStorageAdapter() as PostgresStorageAdapter | undefined;
      if (!store) {
        res.status(503).json({ error: 'Storage not initialized' });
        return;
      }
      const pool = store.getPool();
      if (!pool) {
        res.status(503).json({ error: 'Database pool not available' });
        return;
      }

      const result: MigrationResult = await runMigrations(pool, MIGRATION_FILES, (line) => {
        getLogger().info('MIGRATION_UPGRADE', line);
      });

      res.json({
        ok: true,
        applied: result.applied,
        skipped: result.skipped,
        currentVersion: result.currentVersion,
        appliedMigrations: result.appliedMigrations.map((m) => ({
          version: m.version,
          name: m.name,
          appliedAt: m.applied_at,
        })),
      });
    } catch (e: unknown) {
      getLogger().error('POST_API_MIGRATIONS_RUN', e instanceof Error ? e : String(e));
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : 'migration-run-failed',
      });
    }
  });

  r.get('/api/settings/db/health', async (_req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter();
      if (store) {
        try {
          await healDatabaseStore(store);
        } catch (healErr) {
          getLogger().warn('DB_HEALTH_HEAL', healErr instanceof Error ? healErr.message : String(healErr));
        }
      }
      const status = await buildDbStatus(eng);
      res.json(status.health);
    } catch (e: unknown) {
      getLogger().error('GET_API_SETTINGS_DB_HEALTH', e instanceof Error ? e : String(e));
      res.status(500).json({ status: 'unhealthy', checks: [] });
    }
  });

  r.post('/api/settings/db/clear', async (_req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager?.getStorageAdapter() as PostgresStorageAdapter | undefined;
      if (store && typeof store.clearAll === 'function') {
        await store.clearAll();
      }
      getLogger().info('SETTINGS_DB_CLEAR', 'All session data cleared');
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_SETTINGS_DB_CLEAR', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'settings-db-clear-failed' });
    }
  });

  r.post('/api/settings/db/clear-cache', async (_req, res) => {
    try {
      const cacheDir = getCacheDir();
      let freed = 0;
      if (await pathExists(cacheDir)) {
        for (const f of await readdir(cacheDir)) {
          const fp = join(cacheDir, f);
          try {
            const s = await stat(fp);
            if (s.isFile()) { freed += s.size; await rm(fp); }
          } catch (e) { /* skip */ }
        }
      }
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      let v = freed;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      const freedFormatted = `${v.toFixed(1)} ${units[i]}`;
      getLogger().info('SETTINGS_DB_CLEAR_CACHE', `Cache cleared: ${freedFormatted}`);
      res.json({ ok: true, freedFormatted });
    } catch (e: unknown) {
      getLogger().error('POST_API_SETTINGS_DB_CLEAR_CACHE', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, freedFormatted: '0 B', error: e instanceof Error ? e.message : 'settings-db-clear-cache-failed' });
    }
  });


  return r;
}
