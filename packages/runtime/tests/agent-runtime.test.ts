import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

vi.mock('../src/PostgresLifecycleManager.js', () => ({
  PostgresLifecycleManager: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue('postgresql://agentx:agentx@127.0.0.1:3335/agentx'),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/RedisLifecycleManager.js', () => ({
  RedisLifecycleManager: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue('redis://127.0.0.1:6379'),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock('@agentx/shared', () => ({
  ensureLoginShellPath: vi.fn(),
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  AgentRuntime,
  DEFAULT_PORT,
  DEFAULT_EMBEDDED_PG_PORT,
  DEFAULT_EMBEDDED_REDIS_PORT,
  resolveRuntimePaths,
  isEmbeddedPostgresConnectionString,
  resolvePublicUrl,
  shouldStartEmbeddedPostgresAtBoot,
  readConfiguredPostgresPreference,
  createDesktopRuntimeOptions,
  createServerRuntimeOptions,
  resolveDefaultServerDataDir,
} from '../src/agent-runtime.js';

describe('agent-runtime constants', () => {
  it('exports expected default ports', () => {
    expect(DEFAULT_PORT).toBe(3333);
    expect(DEFAULT_EMBEDDED_PG_PORT).toBe(3335);
    expect(DEFAULT_EMBEDDED_REDIS_PORT).toBe(6379);
  });
});

describe('isEmbeddedPostgresConnectionString', () => {
  it('returns true for 127.0.0.1:3335', () => {
    expect(isEmbeddedPostgresConnectionString('postgresql://user:pass@127.0.0.1:3335/db')).toBe(true);
  });

  it('returns true for localhost:3335', () => {
    expect(isEmbeddedPostgresConnectionString('postgresql://user:pass@localhost:3335/db')).toBe(true);
  });

  it('returns false for remote host', () => {
    expect(isEmbeddedPostgresConnectionString('postgresql://user:pass@db.example.com:5432/db')).toBe(false);
  });

  it('returns false for localhost on non-embedded port', () => {
    expect(isEmbeddedPostgresConnectionString('postgresql://user:pass@localhost:5432/db')).toBe(false);
  });

  it('falls back to regex for invalid URLs', () => {
    expect(isEmbeddedPostgresConnectionString('127.0.0.1:3335')).toBe(true);
    expect(isEmbeddedPostgresConnectionString('not-a-url')).toBe(false);
  });
});

describe('resolvePublicUrl', () => {
  it('returns explicit url with trailing slash trimmed', () => {
    expect(resolvePublicUrl(3333, 'http://example.com/')).toBe('http://example.com');
  });

  it('returns explicit url without trailing slash unchanged', () => {
    expect(resolvePublicUrl(3333, 'http://example.com')).toBe('http://example.com');
  });

  it('falls back to localhost or detected IP when no explicit url', () => {
    const url = resolvePublicUrl(3333);
    expect(url).toMatch(/^http:\/\/(localhost|[\d.]+):3333$/);
  });
});

describe('resolveRuntimePaths', () => {
  it('returns dev paths when isDev is true', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentx-test-'));
    const paths = resolveRuntimePaths({
      mode: 'desktop',
      isDev: true,
      getResourcesPath: () => '/resources',
      getDataDir: () => '/data',
      getDevMonorepoRoot: () => root,
    });
    expect(paths.webApiPath).toContain(join('web-api', 'dist', 'index.js'));
    expect(paths.webUiDir).toContain(join('web-ui', 'dist'));
    expect(paths.voiceSidecarDir).toContain('voice-sidecar');
  });

  it('returns production paths when isDev is false', () => {
    const paths = resolveRuntimePaths({
      mode: 'desktop',
      isDev: false,
      getResourcesPath: () => '/resources',
      getDataDir: () => '/data',
    });
    expect(paths.webApiPath).toBe(join('/resources', 'web-api', 'index.js'));
    expect(paths.webUiDir).toBe(join('/resources', 'web-ui'));
    expect(paths.pythonDir).toContain('python');
  });
});

describe('readConfiguredPostgresPreference', () => {
  let dataDir: string;
  let xdgConfig: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentx-pref-'));
    xdgConfig = mkdtempSync(join(tmpdir(), 'agentx-xdg-'));
    process.env['XDG_CONFIG_HOME'] = xdgConfig;
  });

  afterEach(() => {
    delete process.env['XDG_CONFIG_HOME'];
  });

  it('returns null when no registry file exists', () => {
    const result = readConfiguredPostgresPreference(dataDir);
    expect(result.backend).toBeNull();
    expect(result.connectionString).toBeNull();
  });

  it('returns null when postgresql plugin is not enabled', () => {
    const configDir = join(dataDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'plugin-registry.json'),
      JSON.stringify([{ id: 'postgresql', enabled: false }]),
    );
    const result = readConfiguredPostgresPreference(dataDir);
    expect(result.backend).toBeNull();
    expect(result.connectionString).toBeNull();
  });

  it('returns embedded-postgres for embedded connection string', () => {
    const configDir = join(dataDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'plugin-registry.json'),
      JSON.stringify([{
        id: 'postgresql',
        enabled: true,
        config: { connectionString: 'postgresql://agentx:agentx@127.0.0.1:3335/agentx' },
      }]),
    );
    const result = readConfiguredPostgresPreference(dataDir);
    expect(result.backend).toBe('embedded-postgres');
    expect(result.connectionString).toBe('postgresql://agentx:agentx@127.0.0.1:3335/agentx');
  });

  it('returns postgres for remote connection string', () => {
    const configDir = join(dataDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'plugin-registry.json'),
      JSON.stringify([{
        id: 'postgresql',
        enabled: true,
        config: { connectionString: 'postgresql://user:pass@db.example.com:5432/agentx' },
      }]),
    );
    const result = readConfiguredPostgresPreference(dataDir);
    expect(result.backend).toBe('postgres');
  });

  it('returns explicit backend when set', () => {
    const configDir = join(dataDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'plugin-registry.json'),
      JSON.stringify([{
        id: 'postgresql',
        enabled: true,
        config: { backend: 'postgres', connectionString: 'postgresql://user:pass@db.example.com:5432/agentx' },
      }]),
    );
    const result = readConfiguredPostgresPreference(dataDir);
    expect(result.backend).toBe('postgres');
  });

  it('returns null on invalid JSON', () => {
    const configDir = join(dataDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'plugin-registry.json'), 'not-json');
    const result = readConfiguredPostgresPreference(dataDir);
    expect(result.backend).toBeNull();
    expect(result.connectionString).toBeNull();
  });
});

describe('shouldStartEmbeddedPostgresAtBoot', () => {
  let dataDir: string;
  let xdgConfig: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentx-boot-'));
    xdgConfig = mkdtempSync(join(tmpdir(), 'agentx-boot-xdg-'));
    process.env['XDG_CONFIG_HOME'] = xdgConfig;
    delete process.env['AGENTX_POSTGRES_CONNECTION_STRING'];
    delete process.env['AGENTX_FORCE_EMBEDDED_PG'];
  });

  afterEach(() => {
    delete process.env['XDG_CONFIG_HOME'];
  });

  it('returns use-env when AGENTX_POSTGRES_CONNECTION_STRING is set', () => {
    process.env['AGENTX_POSTGRES_CONNECTION_STRING'] = 'postgresql://user:pass@db.example.com:5432/agentx';
    const result = shouldStartEmbeddedPostgresAtBoot(dataDir);
    expect(result.action).toBe('use-env');
    expect(result.connectionString).toBe('postgresql://user:pass@db.example.com:5432/agentx');
  });

  it('returns start-embedded when AGENTX_FORCE_EMBEDDED_PG is 1', () => {
    process.env['AGENTX_FORCE_EMBEDDED_PG'] = '1';
    const result = shouldStartEmbeddedPostgresAtBoot(dataDir);
    expect(result.action).toBe('start-embedded');
  });

  it('returns defer when no preference and no brain_db', () => {
    const result = shouldStartEmbeddedPostgresAtBoot(dataDir);
    expect(result.action).toBe('defer');
  });

  it('returns start-embedded when brain_db exists', () => {
    mkdirSync(join(dataDir, 'brain_db'), { recursive: true });
    const result = shouldStartEmbeddedPostgresAtBoot(dataDir);
    expect(result.action).toBe('start-embedded');
  });
});

describe('AgentRuntime', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentx-rt-'));
  });

  describe('constructor and accessors', () => {
    it('uses default port when not specified', () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      expect(rt.getPort()).toBe(DEFAULT_PORT);
    });

    it('uses custom port when specified', () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        port: 4000,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      expect(rt.getPort()).toBe(4000);
    });

    it('returns null server before start', () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      expect(rt.getServer()).toBeNull();
    });
  });

  describe('isEmbeddedPostgresRunning', () => {
    it('returns false when no pg manager and env not set', () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      expect(rt.isEmbeddedPostgresRunning()).toBe(false);
    });

    it('returns true when AGENTX_EMBEDDED_PG_ENABLED is 1', () => {
      process.env['AGENTX_EMBEDDED_PG_ENABLED'] = '1';
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      expect(rt.isEmbeddedPostgresRunning()).toBe(true);
      delete process.env['AGENTX_EMBEDDED_PG_ENABLED'];
    });
  });

  describe('isEmbeddedRedisRunning', () => {
    it('returns false when no redis manager', () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      expect(rt.isEmbeddedRedisRunning()).toBe(false);
    });
  });

  describe('getHealth', () => {
    it('returns ok status with pid and uptime', () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      const health = rt.getHealth();
      expect(health.status).toBe('ok');
      expect(health.pid).toBe(process.pid);
      expect(health.server).toBe(false);
    });
  });

  describe('getReadiness', () => {
    it('returns not ready when nothing is running', () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      const readiness = rt.getReadiness();
      expect(readiness.ready).toBe(false);
      expect(readiness.postgres).toBe(false);
      expect(readiness.redis).toBe(false);
      expect(readiness.httpServer).toBe(false);
    });

    it('returns ready when env vars and server are set', () => {
      process.env['AGENTX_POSTGRES_CONNECTION_STRING'] = 'postgresql://localhost:5432/db';
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      (rt as any).httpServer = {};
      const readiness = rt.getReadiness();
      expect(readiness.ready).toBe(true);
      expect(readiness.postgres).toBe(true);
      expect(readiness.redis).toBe(true);
      expect(readiness.httpServer).toBe(true);
      delete process.env['AGENTX_POSTGRES_CONNECTION_STRING'];
      delete process.env['REDIS_URL'];
    });
  });

  describe('stop', () => {
    it('does not throw when nothing was started', async () => {
      const rt = new AgentRuntime({
        mode: 'server',
        isDev: false,
        getResourcesPath: () => '/resources',
        getDataDir: () => dataDir,
      });
      await expect(rt.stop()).resolves.toBeUndefined();
    });
  });
});

describe('createDesktopRuntimeOptions', () => {
  it('creates desktop mode options', () => {
    const opts = createDesktopRuntimeOptions({
      isDev: true,
      getResourcesPath: () => '/resources',
      getDataDir: () => '/data',
    });
    expect(opts.mode).toBe('desktop');
    expect(opts.isDev).toBe(true);
    expect(opts.listenHost).toBe('127.0.0.1');
    expect(opts.publicUrl).toBe(`http://localhost:${DEFAULT_PORT}`);
  });
});

describe('createServerRuntimeOptions', () => {
  afterEach(() => {
    delete process.env['AGENTX_INSTALL_DIR'];
    delete process.env['AGENTX_DATA_DIR'];
    delete process.env['AGENTX_PORT'];
    delete process.env['AGENTX_HOST'];
  });

  it('creates server mode options with defaults', () => {
    const opts = createServerRuntimeOptions();
    expect(opts.mode).toBe('server');
    expect(opts.isDev).toBe(false);
    expect(opts.port).toBe(DEFAULT_PORT);
    expect(opts.listenHost).toBe('127.0.0.1');
  });

  it('respects explicit port', () => {
    const opts = createServerRuntimeOptions({ port: 4000 });
    expect(opts.port).toBe(4000);
  });

  it('respects AGENTX_PORT env', () => {
    process.env['AGENTX_PORT'] = '5000';
    const opts = createServerRuntimeOptions();
    expect(opts.port).toBe(5000);
  });

  it('respects explicit listenHost', () => {
    const opts = createServerRuntimeOptions({ listenHost: '0.0.0.0' });
    expect(opts.listenHost).toBe('0.0.0.0');
  });
});

describe('resolveDefaultServerDataDir', () => {
  afterEach(() => {
    delete process.env['AGENTX_DATA_DIR'];
    delete process.env['XDG_DATA_HOME'];
  });

  it('prefers AGENTX_DATA_DIR', () => {
    process.env['AGENTX_DATA_DIR'] = '/custom/data';
    expect(resolveDefaultServerDataDir()).toBe('/custom/data');
  });
});
