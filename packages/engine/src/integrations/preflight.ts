import { access, constants } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { promisify } from 'node:util';
import type { IntegrationProvider, SetupPreflightCheckId, SetupPreflightResult } from '@agentx/shared';
import { canUseHubBrowserOAuth } from '@agentx/shared';
import { getIntegrationHubSettings } from './catalog/loader.js';

const execFileAsync = promisify(execFile);

export interface PreflightContext {
  env?: Record<string, string>;
  folderPath?: string;
  remoteUrl?: string;
}

function envValue(context: PreflightContext | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = context?.env?.[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

async function checkNode(): Promise<SetupPreflightResult> {
  try {
    const { stdout } = await execFileAsync('node', ['--version'], { timeout: 5000 });
    return {
      id: 'node_available',
      ok: true,
      message: `Node.js ${stdout.trim()} detected`,
    };
  } catch {
    return {
      id: 'node_available',
      ok: false,
      message: 'Node.js is not available on PATH',
      fixHint: 'Install Node.js 20+ or restart Agent-X after installing it.',
    };
  }
}

async function checkNpx(): Promise<SetupPreflightResult> {
  try {
    const { stdout } = await execFileAsync('npx', ['--version'], { timeout: 8000 });
    return {
      id: 'npx_available',
      ok: true,
      message: `npx ${stdout.trim()} detected`,
    };
  } catch {
    return {
      id: 'npx_available',
      ok: false,
      message: 'npx is not available — required to start local MCP servers',
      fixHint: 'Install Node.js (includes npx) or ensure it is on your PATH.',
    };
  }
}

async function checkNetwork(): Promise<SetupPreflightResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    await fetch('https://registry.npmjs.org/', { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    return {
      id: 'network_reachable',
      ok: true,
      message: 'Network reachable (npm registry)',
    };
  } catch {
    return {
      id: 'network_reachable',
      ok: false,
      message: 'Cannot reach the npm registry',
      fixHint: 'Check your internet connection or proxy settings, then try again.',
    };
  }
}

function checkOAuthEnv(provider: IntegrationProvider): SetupPreflightResult {
  const envKey = provider.auth.oauth?.clientIdEnv;
  if (!envKey) {
    return {
      id: 'oauth_env_configured',
      ok: true,
      message: 'OAuth client env not required',
    };
  }
  const fromSettings = getIntegrationHubSettings().oauthClientIds?.[provider.id]?.trim();
  if (fromSettings) {
    return {
      id: 'oauth_env_configured',
      ok: true,
      message: 'OAuth Client ID configured in Agent-X settings',
    };
  }
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    return {
      id: 'oauth_env_configured',
      ok: true,
      message: `${envKey} is configured`,
    };
  }
  return {
    id: 'oauth_env_configured',
    ok: false,
    message: 'OAuth Client ID is not configured',
    fixHint: `Paste your OAuth Client ID below to save it — or set ${envKey} in the environment.`,
  };
}

function checkOAuthClient(provider: IntegrationProvider): SetupPreflightResult {
  if (!canUseHubBrowserOAuth(provider)) {
    return {
      id: 'oauth_client_configured',
      ok: false,
      message: 'Browser sign-in is not configured for this provider',
      fixHint: 'Use the guided API key flow or contact support for OAuth setup.',
    };
  }
  return {
    id: 'oauth_client_configured',
    ok: true,
    message: 'Browser sign-in is available',
  };
}

async function checkFolderReadable(_provider: IntegrationProvider, context?: PreflightContext): Promise<SetupPreflightResult> {
  const path = context?.folderPath?.trim();
  if (!path) {
    return {
      id: 'folder_readable',
      ok: false,
      message: 'Choose a folder before continuing',
      fixHint: 'Use Browse to pick the folder Agent-X may access.',
    };
  }
  try {
    await access(path, constants.R_OK);
    return { id: 'folder_readable', ok: true, message: `Folder readable: ${path}` };
  } catch {
    return {
      id: 'folder_readable',
      ok: false,
      message: `Cannot read folder: ${path}`,
      fixHint: 'Pick a different folder or grant read access in System Settings → Privacy.',
    };
  }
}

async function checkFolderWritable(_provider: IntegrationProvider, context?: PreflightContext): Promise<SetupPreflightResult> {
  const path = context?.folderPath?.trim();
  if (!path) {
    return {
      id: 'folder_writable',
      ok: false,
      message: 'Choose a folder before continuing',
      fixHint: 'Use Browse to pick the folder Agent-X may access.',
    };
  }
  try {
    await access(path, constants.W_OK);
    return { id: 'folder_writable', ok: true, message: `Folder writable: ${path}` };
  } catch {
    return {
      id: 'folder_writable',
      ok: false,
      message: `Cannot write to folder: ${path}`,
      fixHint: 'Pick a different folder or grant write access in System Settings → Privacy.',
    };
  }
}

function parseHostPort(raw: string, defaultPort: number): { host: string; port: number } | null {
  try {
    if (raw.startsWith('redis://') || raw.startsWith('rediss://')) {
      const url = new URL(raw);
      return { host: url.hostname, port: url.port ? Number(url.port) : defaultPort };
    }
    if (raw.startsWith('postgres://') || raw.startsWith('postgresql://')) {
      const url = new URL(raw);
      return { host: url.hostname, port: url.port ? Number(url.port) : defaultPort };
    }
    if (raw.includes('://')) return null;
    const [host, portStr] = raw.split(':');
    if (!host) return null;
    return { host, port: portStr ? Number(portStr) : defaultPort };
  } catch {
    return null;
  }
}

function tcpReachable(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port, timeout: timeoutMs });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function checkPostgresReachable(_provider: IntegrationProvider, context?: PreflightContext): Promise<SetupPreflightResult> {
  const url = envValue(context, 'DATABASE_URL', 'POSTGRES_CONNECTION_STRING', 'POSTGRES_URL');
  if (!url) {
    return {
      id: 'postgres_reachable',
      ok: false,
      message: 'Enter a Postgres connection string first',
      fixHint: 'Use a read-only URL, e.g. postgres://user:pass@host:5432/db',
    };
  }
  const target = parseHostPort(url, 5432);
  if (!target) {
    return {
      id: 'postgres_reachable',
      ok: false,
      message: 'Postgres URL format is invalid',
      fixHint: 'Use postgres://user:pass@host:5432/database',
    };
  }
  const ok = await tcpReachable(target.host, target.port);
  return ok
    ? { id: 'postgres_reachable', ok: true, message: `Postgres host reachable (${target.host}:${target.port})` }
    : {
        id: 'postgres_reachable',
        ok: false,
        message: `Cannot reach Postgres at ${target.host}:${target.port}`,
        fixHint: 'Check the host, port, firewall, and that Postgres is running.',
      };
}

async function checkRedisReachable(_provider: IntegrationProvider, context?: PreflightContext): Promise<SetupPreflightResult> {
  const url = envValue(context, 'REDIS_URL');
  if (!url) {
    return {
      id: 'redis_reachable',
      ok: false,
      message: 'Enter a Redis URL first',
      fixHint: 'Use redis://localhost:6379 or your cloud Redis URL.',
    };
  }
  const target = parseHostPort(url, 6379);
  if (!target) {
    return {
      id: 'redis_reachable',
      ok: false,
      message: 'Redis URL format is invalid',
      fixHint: 'Use redis://host:6379',
    };
  }
  const ok = await tcpReachable(target.host, target.port);
  return ok
    ? { id: 'redis_reachable', ok: true, message: `Redis host reachable (${target.host}:${target.port})` }
    : {
        id: 'redis_reachable',
        ok: false,
        message: `Cannot reach Redis at ${target.host}:${target.port}`,
        fixHint: 'Check the URL, firewall, and that Redis is running.',
      };
}

async function checkLocalPort(_provider: IntegrationProvider, context?: PreflightContext): Promise<SetupPreflightResult> {
  const url = context?.remoteUrl?.trim();
  if (!url) {
    return {
      id: 'local_port_reachable',
      ok: true,
      message: 'Local service URL can be tested on the connection step',
    };
  }
  try {
    const parsed = new URL(url);
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    const ok = await tcpReachable(parsed.hostname, port);
    return ok
      ? { id: 'local_port_reachable', ok: true, message: `Service reachable at ${parsed.hostname}:${port}` }
      : {
          id: 'local_port_reachable',
          ok: false,
          message: `Cannot reach ${parsed.hostname}:${port}`,
          fixHint: 'Ensure the service is running and reachable on your local network.',
        };
  } catch {
    return {
      id: 'local_port_reachable',
      ok: false,
      message: 'Invalid service URL',
      fixHint: 'Enter a valid http(s) URL for your local MCP endpoint.',
    };
  }
}

type CheckRunner = (
  provider: IntegrationProvider,
  context?: PreflightContext,
) => Promise<SetupPreflightResult> | SetupPreflightResult;

const CHECK_RUNNERS: Record<SetupPreflightCheckId, CheckRunner> = {
  node_available: () => checkNode(),
  npx_available: () => checkNpx(),
  network_reachable: () => checkNetwork(),
  oauth_env_configured: (provider) => checkOAuthEnv(provider),
  oauth_client_configured: (provider) => checkOAuthClient(provider),
  mcp_handshake: () => ({
    id: 'mcp_handshake',
    ok: true,
    message: 'Run connection test after entering credentials',
  }),
  folder_readable: checkFolderReadable,
  folder_writable: checkFolderWritable,
  postgres_reachable: checkPostgresReachable,
  redis_reachable: checkRedisReachable,
  local_port_reachable: checkLocalPort,
};

export async function runPreflightChecks(
  provider: IntegrationProvider,
  checkIds: SetupPreflightCheckId[],
  context?: PreflightContext,
): Promise<SetupPreflightResult[]> {
  const unique = [...new Set(checkIds)];
  const results: SetupPreflightResult[] = [];
  for (const id of unique) {
    const runner = CHECK_RUNNERS[id];
    if (!runner) continue;
    results.push(await runner(provider, context));
  }
  return results;
}
