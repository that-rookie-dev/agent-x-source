export { AgentRuntime, createDesktopRuntimeOptions, createServerRuntimeOptions, resolveRuntimePaths, resolvePublicUrl } from '@agentx/runtime';
export type { AgentRuntimeOptions, AgentRuntimePaths, VaultStorageAdapter } from '@agentx/runtime';

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRuntime, createServerRuntimeOptions } from '@agentx/runtime';

function isDevServer(): boolean {
  // Detect when the server is being run from the monorepo source tree.
  const devWebApi = join(__dirname, '..', '..', 'web-api', 'dist', 'index.js');
  return existsSync(devWebApi);
}

/**
 * Create an Agent-X server runtime (Postgres + Redis + web-api).
 * Callers can inspect the runtime before starting it.
 */
export function createServer(): AgentRuntime {
  process.env['AGENTX_SERVER_MODE'] = '1';
  const options = createServerRuntimeOptions({ isDev: isDevServer() });
  return new AgentRuntime(options);
}

/**
 * Start the server runtime and block until the process is signaled.
 * Returns the active runtime instance.
 */
export async function start(): Promise<AgentRuntime> {
  const runtime = createServer();
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down Agent-X server...`);
    try {
      await runtime.stop();
    } catch (e) {
      console.error('Shutdown error:', e);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  await runtime.start();

  const port = runtime.getPort();
  const host = process.env['AGENTX_HOST'] ?? '127.0.0.1';
  console.log(`Agent-X server running at http://${host}:${port}`);

  return runtime;
}
