import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { getBuiltinPlugin } from '@agentx/engine';

export function createPluginsRouter(): Router {
  const r = Router();

  // ───── Plugin Hub ─────
  r.get('/api/plugins', (_req, res) => {
    const eng = getEngine();
    const plugins = eng.pluginRegistry.getInstalled();
    res.json({ plugins });
  });

  r.get('/api/plugins/categories', (_req, res) => {
    const eng = getEngine();
    const categories = eng.pluginRegistry.getCategories();
    const installed = eng.pluginRegistry.getInstalledByCategoryGrouped();
    const available = eng.pluginRegistry.getAvailableByCategory();
    res.json({ categories, installed, available });
  });

  r.get('/api/plugins/available', (_req, res) => {
    const eng = getEngine();
    const plugins = eng.pluginRegistry.getAvailable();
    res.json({ plugins });
  });

  r.get('/api/plugins/installed', (_req, res) => {
    const eng = getEngine();
    const plugins = eng.pluginRegistry.getInstalled();
    res.json({ plugins });
  });

  r.post('/api/plugins/:id/install', async (req, res) => {
    const eng = getEngine();
    const { id } = req.params;
    const entry = getBuiltinPlugin(id!);
    if (!entry) {
      res.status(404).json({ error: `Plugin "${id}" not found in catalog` });
      return;
    }
    try {
      const plugin = eng.pluginRegistry.install(entry);
      res.json({ plugin });
    } catch (e: unknown) {
      getLogger().error('POST_API_PLUGINS_ID_INSTALL', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'install-failed' });
    }
  });

  r.post('/api/plugins/:id/uninstall', (req, res) => {
    const eng = getEngine();
    try {
      eng.pluginRegistry.uninstall(req.params['id']!);
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_PLUGINS_ID_UNINSTALL', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'uninstall-failed' });
    }
  });

  r.post('/api/plugins/:id/toggle', (req, res) => {
    const eng = getEngine();
    try {
      const enabled = eng.pluginRegistry.toggle(req.params['id']!);
      res.json({ enabled });
    } catch (e: unknown) {
      getLogger().error('POST_API_PLUGINS_ID_TOGGLE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
    }
  });

  r.get('/api/plugins/:id', (req, res) => {
    const eng = getEngine();
    const plugin = eng.pluginRegistry.getPlugin(req.params['id']!);
    if (!plugin) {
      res.status(404).json({ error: 'Plugin not installed' });
      return;
    }
    res.json({ plugin });
  });

  r.put('/api/plugins/:id/config', (req, res) => {
    const eng = getEngine();
    const { config } = req.body as { config?: Record<string, unknown> };
    if (!config) {
      res.status(400).json({ error: 'config object required' });
      return;
    }
    try {
      const plugin = eng.pluginRegistry.updateConfig(req.params['id']!, config);
      res.json({ plugin });
    } catch (e: unknown) {
      getLogger().error('PUT_API_PLUGINS_ID_CONFIG', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'config-failed' });
    }
  });

  // ───── PostgreSQL Plugin ─────
  r.post('/api/plugins/postgresql/test-connection', async (req, res) => {
    const { connectionString } = req.body as { connectionString?: string };
    if (!connectionString) {
      res.status(400).json({ error: 'connectionString required' });
      return;
    }
    try {
      // Dynamically import pg to avoid requiring it during typecheck in environments
      // where pg is not installed. This will throw at runtime if pg is missing.

      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString, max: 1 });
      const client = await pool.connect();
      const result = await client.query('SELECT version() as version');
      const pgVersion = result.rows[0]?.['version'] as string;
      client.release();
      await pool.end();
      res.json({ ok: true, version: pgVersion || 'connected' });
    } catch (e: unknown) {
      getLogger().error('POST_API_PLUGINS_POSTGRESQL_TEST_CONNECTION', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'connection-failed' });
    }
  });

  r.get('/api/plugins/postgresql/comparison', (_req, res) => {
    res.json({
      comparison: [
        {
          feature: 'Setup',
          sqlite: 'Zero-config, embedded in app data directory',
          postgresql: 'Requires external PostgreSQL server, connection string',
        },
        {
          feature: 'Concurrency',
          sqlite: 'Single-writer, limited concurrent reads',
          postgresql: 'Full concurrent read/write with connection pooling',
        },
        {
          feature: 'Storage Limit',
          sqlite: '~140TB theoretical, but degrades past ~100GB',
          postgresql: 'Petabyte-scale, enterprise-grade',
        },
        {
          feature: 'Performance',
          sqlite: 'Fast for local single-user use',
          postgresql: 'Optimized for multi-user, parallel queries',
        },
        {
          feature: 'User Management',
          sqlite: 'File-system permissions only',
          postgresql: 'Role-based access control, SSL, auth methods',
        },
        {
          feature: 'Replication',
          sqlite: 'None (file copy backup)',
          postgresql: 'Streaming replication, logical replication, hot standby',
        },
        {
          feature: 'Cloud Deployment',
          sqlite: 'Not suitable (file-locking issues)',
          postgresql: 'Native support on AWS RDS, Azure DB, GCP Cloud SQL',
        },
        {
          feature: 'Backup & Restore',
          sqlite: 'File-level copy',
          postgresql: 'pg_dump, pg_backrest, WAL archiving, point-in-time recovery',
        },
        {
          feature: 'Migration',
          sqlite: 'N/A (default storage)',
          postgresql: 'Automatic schema migration on connect',
        },
      ],
    });
  });

  return r;
}
