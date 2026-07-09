import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { arch, homedir, networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { ensureLoginShellPath } from '@agentx/shared';
import { PostgresLifecycleManager } from './PostgresLifecycleManager.js';

export const DEFAULT_PORT = 3333;
export const DEFAULT_EMBEDDED_PG_PORT = 3335;

export interface VaultStorageAdapter {
  isEncryptionAvailable(): boolean;
  decryptString(buffer: Buffer): string;
  encryptString(text: string): Buffer;
}

export interface AgentRuntimeOptions {
  mode: 'desktop' | 'server';
  port?: number;
  embeddedPgPort?: number;
  isDev: boolean;
  getResourcesPath: () => string;
  getDataDir: () => string;
  /** Dev-only: monorepo root for web-api/ui paths */
  getDevMonorepoRoot?: () => string;
  vaultStorage?: VaultStorageAdapter;
  listenHost?: string;
  publicUrl?: string;
}

export interface AgentRuntimePaths {
  webApiPath: string;
  webUiDir: string;
  webNeuronDir: string;
  pythonPath: string;
  pythonDir: string;
  ffmpegPath: string;
  ffmpegDir: string;
  voiceSidecarDir: string;
  voiceBundleDir: string;
  voiceManifestPath: string;
}

function resolveBundledFfmpeg(resourcesPath: string): { ffmpegPath: string; ffmpegDir: string } {
  const ffmpegDir = join(resourcesPath, 'ffmpeg', 'bin');
  const ffmpegPath = process.platform === 'win32'
    ? join(ffmpegDir, 'ffmpeg.exe')
    : join(ffmpegDir, 'ffmpeg');
  return { ffmpegPath, ffmpegDir };
}

export function resolveRuntimePaths(options: AgentRuntimeOptions): AgentRuntimePaths {
  const resourcesPath = options.getResourcesPath();
  if (options.isDev) {
    const root = options.getDevMonorepoRoot?.() ?? join(__dirname, '..', '..', '..');
    const devFfmpeg = resolveBundledFfmpeg(join(root, 'packages', 'runtime'));
    return {
      webApiPath: join(root, 'packages', 'web-api', 'dist', 'index.js'),
      webUiDir: join(root, 'packages', 'web-ui', 'dist'),
      webNeuronDir: join(root, 'packages', 'web-neuron', 'dist'),
      pythonPath: process.env['AGENTX_PYTHON_PATH'] || 'python3',
      pythonDir: '',
      ffmpegPath: process.env['AGENTX_FFMPEG_PATH']
        || (existsSync(devFfmpeg.ffmpegPath) ? devFfmpeg.ffmpegPath : 'ffmpeg'),
      ffmpegDir: existsSync(devFfmpeg.ffmpegDir) ? devFfmpeg.ffmpegDir : '',
      voiceSidecarDir: join(root, 'packages', 'voice-sidecar'),
      voiceBundleDir: join(root, 'packages', 'voice-sidecar', 'bundled'),
      voiceManifestPath: join(root, 'packages', 'voice-sidecar', 'voice-models.manifest.json'),
    };
  }

  const pythonDir = process.platform === 'win32'
    ? join(resourcesPath, 'python')
    : join(resourcesPath, 'python', 'bin');
  // Prefer python3, but fall back to versioned binaries when pack left a broken
  // absolute symlink (common when CI copied PBS without dereference).
  const pythonCandidates = process.platform === 'win32'
    ? [join(pythonDir, 'python.exe')]
    : [
      join(pythonDir, 'python3'),
      join(pythonDir, 'python3.12'),
      join(pythonDir, 'python'),
    ];
  const pythonPath = pythonCandidates.find((p) => existsSync(p)) ?? pythonCandidates[0]!;
  const { ffmpegPath, ffmpegDir } = resolveBundledFfmpeg(resourcesPath);

  return {
    webApiPath: join(resourcesPath, 'web-api', 'index.js'),
    webUiDir: join(resourcesPath, 'web-ui'),
    webNeuronDir: join(resourcesPath, 'web-neuron'),
    pythonPath,
    pythonDir,
    ffmpegPath,
    ffmpegDir,
    voiceSidecarDir: join(resourcesPath, 'voice-sidecar'),
    voiceBundleDir: join(resourcesPath, 'voice-sidecar', 'bundled'),
    voiceManifestPath: join(resourcesPath, 'voice-sidecar', 'voice-models.manifest.json'),
  };
}

export function ensureEmbeddedPgLibPath(installDir: string): void {
  const plat = process.platform;
  if (plat !== 'linux' && plat !== 'darwin') return;

  const pkg = plat === 'linux'
    ? (arch() === 'arm64' ? '@embedded-postgres/linux-arm64' : '@embedded-postgres/linux-x64')
    : (arch() === 'arm64' ? '@embedded-postgres/darwin-arm64' : '@embedded-postgres/darwin-x64');

  const libDirs = [
    join(installDir, 'node_modules', ...pkg.split('/'), 'native', 'lib'),
    join(installDir, 'node_modules', ...pkg.split('/'), 'native', 'lib', 'postgresql'),
  ].filter((dir) => existsSync(dir));

  if (libDirs.length === 0) return;

  const prefix = libDirs.join(':');
  const libPathKey = plat === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const existing = process.env[libPathKey];
  process.env[libPathKey] = existing ? `${prefix}:${existing}` : prefix;
}

export function setupPythonEnv(paths: AgentRuntimePaths, isDev: boolean): void {
  if (existsSync(paths.pythonPath)) {
    process.env['AGENTX_PYTHON_PATH'] = paths.pythonPath;
    if (paths.pythonDir) {
      process.env['PATH'] = paths.pythonDir + (process.platform === 'win32' ? ';' : ':') + (process.env['PATH'] || '');
    }
    console.log(`Bundled Python: ${paths.pythonPath}`);
  } else if (isDev) {
    console.log('Development mode: using system Python');
  } else {
    console.warn('Bundled Python not found at', paths.pythonPath);
  }

  setupFfmpegEnv(paths, isDev);
}

/** True when connection string points at the local embedded PG (127.0.0.1:3335 / agentx). */
export function isEmbeddedPostgresConnectionString(connectionString: string): boolean {
  try {
    const u = new URL(connectionString);
    const host = u.hostname;
    const port = u.port || '5432';
    const localHost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    return localHost && port === String(DEFAULT_EMBEDDED_PG_PORT);
  } catch {
    return /127\.0\.0\.1:3335|localhost:3335/i.test(connectionString);
  }
}

function resolveConfigDirForDataDir(dataDir: string): string {
  // Desktop Electron uses userData as dataDir and often stores config beside it.
  const besideData = join(dataDir, 'config');
  if (existsSync(join(besideData, 'plugin-registry.json')) || existsSync(join(besideData, 'config.json'))) {
    return besideData;
  }
  if (process.env['XDG_CONFIG_HOME']) {
    return join(process.env['XDG_CONFIG_HOME'], 'agentx');
  }
  return join(homedir(), '.config', 'agentx');
}

/**
 * Read the user's chosen Postgres backend from plugin-registry.json (written by setup wizard).
 * Returns null when unset / first-run (caller should start embedded PG).
 */
export function readConfiguredPostgresPreference(dataDir: string): {
  backend: 'embedded-postgres' | 'postgres' | null;
  connectionString: string | null;
} {
  const configDir = resolveConfigDirForDataDir(dataDir);
  const registryPath = join(configDir, 'plugin-registry.json');
  if (!existsSync(registryPath)) {
    return { backend: null, connectionString: null };
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf-8')) as Array<{
      id?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    }>;
    const pg = Array.isArray(raw) ? raw.find((p) => p?.id === 'postgresql') : undefined;
    if (!pg?.enabled) {
      return { backend: null, connectionString: null };
    }
    const cfg = pg.config ?? {};
    const connectionString = typeof cfg['connectionString'] === 'string'
      ? cfg['connectionString'].trim()
      : null;
    const backendRaw = cfg['backend'];
    if (backendRaw === 'embedded-postgres' || backendRaw === 'postgres') {
      return { backend: backendRaw, connectionString };
    }
    if (connectionString && !isEmbeddedPostgresConnectionString(connectionString)) {
      return { backend: 'postgres', connectionString };
    }
    if (connectionString && isEmbeddedPostgresConnectionString(connectionString)) {
      return { backend: 'embedded-postgres', connectionString };
    }
    return { backend: null, connectionString };
  } catch {
    return { backend: null, connectionString: null };
  }
}

export function setupFfmpegEnv(paths: AgentRuntimePaths, isDev: boolean): void {
  if (existsSync(paths.ffmpegPath)) {
    process.env['AGENTX_FFMPEG_PATH'] = paths.ffmpegPath;
    if (paths.ffmpegDir) {
      process.env['PATH'] = paths.ffmpegDir + (process.platform === 'win32' ? ';' : ':') + (process.env['PATH'] || '');
    }
    console.log(`Bundled ffmpeg: ${paths.ffmpegPath}`);
  } else if (isDev) {
    console.log('Development mode: using system ffmpeg (if available)');
  } else {
    console.warn('Bundled ffmpeg not found at', paths.ffmpegPath);
  }
}

function detectPrimaryIPv4(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const entries = nets[name];
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

export function resolvePublicUrl(port: number, explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, '');
  const ip = detectPrimaryIPv4();
  if (ip) return `http://${ip}:${port}`;
  return `http://localhost:${port}`;
}

async function initializeVaultKey(dataDir: string, vaultStorage?: VaultStorageAdapter): Promise<void> {
  if (process.env['AGENTX_VAULT_KEY']) return;

  const configDir = join(dataDir, 'vault');
  mkdirSync(configDir, { recursive: true });

  if (vaultStorage?.isEncryptionAvailable()) {
    const keyFile = join(configDir, 'vault-key.enc');
    if (existsSync(keyFile)) {
      try {
        const encrypted = readFileSync(keyFile);
        process.env['AGENTX_VAULT_KEY'] = vaultStorage.decryptString(encrypted);
        return;
      } catch (e) {
        console.error('Failed to decrypt vault key, generating new one:', e);
      }
    }

    const key = randomBytes(32).toString('base64');
    try {
      const encrypted = vaultStorage.encryptString(key);
      writeFileSync(keyFile, encrypted);
    } catch (e) {
      console.error('Failed to encrypt vault key:', e);
    }
    process.env['AGENTX_VAULT_KEY'] = key;
    return;
  }

  const plainKeyFile = join(configDir, 'vault-key');
  if (existsSync(plainKeyFile)) {
    process.env['AGENTX_VAULT_KEY'] = readFileSync(plainKeyFile, 'utf-8').trim();
    return;
  }

  const key = randomBytes(32).toString('base64');
  writeFileSync(plainKeyFile, key, { mode: 0o600 });
  try { chmodSync(plainKeyFile, 0o600); } catch { /* windows */ }
  process.env['AGENTX_VAULT_KEY'] = key;
}

export class AgentRuntime {
  private readonly options: AgentRuntimeOptions;
  private readonly port: number;
  private readonly embeddedPgPort: number;
  private pgManager: PostgresLifecycleManager | null = null;
  private httpServer: Server | null = null;

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.port = options.port ?? DEFAULT_PORT;
    this.embeddedPgPort = options.embeddedPgPort ?? DEFAULT_EMBEDDED_PG_PORT;
  }

  getPort(): number {
    return this.port;
  }

  getServer(): Server | null {
    return this.httpServer;
  }

  setupPythonEnv(): void {
    setupPythonEnv(resolveRuntimePaths(this.options), this.options.isDev);
  }

  async startEmbeddedPostgres(): Promise<string | null> {
    // Explicit env always wins (CI smoke, operators, overrides).
    if (process.env['AGENTX_POSTGRES_CONNECTION_STRING']) {
      console.log('[startup] Using AGENTX_POSTGRES_CONNECTION_STRING from environment');
      return process.env['AGENTX_POSTGRES_CONNECTION_STRING'];
    }

    const pref = readConfiguredPostgresPreference(this.options.getDataDir());
    if (pref.backend === 'postgres' && pref.connectionString) {
      console.log('[startup] Cloud/remote PostgreSQL configured — skipping embedded Postgres');
      process.env['AGENTX_POSTGRES_CONNECTION_STRING'] = pref.connectionString;
      process.env['AGENTX_EMBEDDED_PG_ENABLED'] = '0';
      return pref.connectionString;
    }

    console.log('[startup] Starting embedded PostgreSQL…');
    const dataDir = join(this.options.getDataDir(), 'brain_db');
    this.pgManager = new PostgresLifecycleManager({
      dataDir,
      port: this.embeddedPgPort,
      host: '127.0.0.1',
      user: 'agentx',
      password: 'agentx',
      database: 'agentx',
      onLog: (msg) => console.log(`[PG] ${msg}`),
      onError: (msg) => console.error(`[PG] ${msg}`),
    });

    try {
      const connectionString = await this.pgManager.start();
      process.env['AGENTX_POSTGRES_CONNECTION_STRING'] = connectionString;
      process.env['AGENTX_EMBEDDED_PG_ENABLED'] = '1';
      return connectionString;
    } catch (e) {
      this.pgManager = null;
      throw e;
    }
  }

  async stopEmbeddedPostgres(): Promise<void> {
    if (this.pgManager) {
      await this.pgManager.stop();
      this.pgManager = null;
    }
  }

  async start(): Promise<void> {
    const paths = resolveRuntimePaths(this.options);
    if (!existsSync(paths.webApiPath)) {
      throw new Error(`Web-API not found at ${paths.webApiPath}`);
    }

    console.log('[startup] 1/4 Preparing runtime environment…');
    ensureLoginShellPath();
    this.setupPythonEnv();

    console.log('[startup] 2/4 Resolving database…');
    await this.startEmbeddedPostgres();

    console.log('[startup] 3/4 Initializing vault key…');
    await initializeVaultKey(this.options.getDataDir(), this.options.vaultStorage);

    const listenHost = this.options.listenHost
      ?? '127.0.0.1';
    const publicUrl = resolvePublicUrl(
      this.port,
      this.options.publicUrl
        ?? (this.options.mode === 'server' ? undefined : `http://localhost:${this.port}`),
    );

    process.env['AGENTX_UI_DIR'] = paths.webUiDir;
    process.env['AGENTX_NEURON_DIR'] = paths.webNeuronDir;
    if (existsSync(paths.voiceSidecarDir)) {
      process.env['AGENTX_VOICE_SIDECAR_DIR'] = paths.voiceSidecarDir;
    }
    if (existsSync(paths.voiceManifestPath)) {
      process.env['AGENTX_VOICE_MANIFEST_PATH'] = paths.voiceManifestPath;
    }
    if (existsSync(paths.voiceBundleDir)) {
      process.env['AGENTX_VOICE_BUNDLE_DIR'] = paths.voiceBundleDir;
    }
    process.env['PORT'] = String(this.port);
    process.env['AGENTX_PORT'] = String(this.port);
    process.env['AGENTX_HOST'] = listenHost;
    process.env['AGENTX_PUBLIC_URL'] = publicUrl;
    process.env['NODE_ENV'] = 'production';

    console.log(`[startup] 4/4 Starting web API on ${listenHost}:${this.port}…`);
    const mod = await import(pathToFileURL(paths.webApiPath).href);
    if (mod.server) this.httpServer = mod.server as Server;
    console.log(`[startup] Agent-X is active at http://127.0.0.1:${this.port}`);
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }
    await this.stopEmbeddedPostgres();
  }
}

export function createDesktopRuntimeOptions(params: {
  isDev: boolean;
  getResourcesPath: () => string;
  getDataDir: () => string;
  vaultStorage?: VaultStorageAdapter;
  getDevMonorepoRoot?: () => string;
}): AgentRuntimeOptions {
  return {
    mode: 'desktop',
    isDev: params.isDev,
    getResourcesPath: params.getResourcesPath,
    getDataDir: params.getDataDir,
    vaultStorage: params.vaultStorage,
    getDevMonorepoRoot: params.getDevMonorepoRoot,
    listenHost: '127.0.0.1',
    publicUrl: `http://localhost:${DEFAULT_PORT}`,
  };
}

export function createServerRuntimeOptions(params?: {
  installDir?: string;
  dataDir?: string;
  port?: number;
  publicUrl?: string;
  listenHost?: string;
}): AgentRuntimeOptions {
  const installDir = params?.installDir
    ?? process.env['AGENTX_INSTALL_DIR']
    ?? join(process.env['HOME'] || '', '.agentx');
  const dataDir = params?.dataDir
    ?? process.env['AGENTX_DATA_DIR']
    ?? join(process.env['XDG_DATA_HOME'] || join(process.env['HOME'] || '', '.local', 'share'), 'agentx');

  process.env['AGENTX_INSTALL_DIR'] = installDir;
  ensureEmbeddedPgLibPath(installDir);

  const envPort = process.env['AGENTX_PORT'] ? Number(process.env['AGENTX_PORT']) : NaN;
  const port = params?.port
    ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PORT);

  return {
    mode: 'server',
    isDev: false,
    port,
    getResourcesPath: () => join(installDir, 'resources'),
    getDataDir: () => dataDir,
    listenHost: params?.listenHost ?? process.env['AGENTX_HOST'] ?? '127.0.0.1',
    publicUrl: params?.publicUrl ?? process.env['AGENTX_PUBLIC_URL'],
  };
}

export function resolveDefaultServerDataDir(): string {
  return process.env['AGENTX_DATA_DIR']
    ?? join(process.env['XDG_DATA_HOME'] || join(process.env['HOME'] || '', '.local', 'share'), 'agentx');
}
