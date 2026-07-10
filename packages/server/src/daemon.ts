import { AgentRuntime, createServerRuntimeOptions, resolvePublicUrl } from '@agentx/runtime';

let runtime: AgentRuntime | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down Agent-X server...`);
  try {
    await runtime?.stop();
  } catch (e) {
    console.error('Shutdown error:', e);
  }
  process.exit(0);
}

async function main(): Promise<void> {
  process.env['AGENTX_SERVER_MODE'] = '1';

  const options = createServerRuntimeOptions();
  runtime = new AgentRuntime(options);
  // setupPythonEnv + staged startup (may defer embedded PG on first-run) happen inside runtime.start()
  await runtime.start();

  const port = runtime.getPort();
  const url = resolvePublicUrl(port, process.env['AGENTX_PUBLIC_URL']);
  const host = process.env['AGENTX_HOST'] ?? '127.0.0.1';
  console.log(`Agent-X server running at ${url}`);
  console.log(`Listening on ${host}:${port}`);
  if (process.env['AGENTX_EMBEDDED_PG_ENABLED'] !== '1' && !process.env['AGENTX_POSTGRES_CONNECTION_STRING']) {
    console.log('[startup] Database not provisioned yet — open the Web UI setup wizard to choose Embedded or Cloud PostgreSQL');
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

main().catch(async (err) => {
  console.error('Agent-X server failed to start:', err);
  try {
    await runtime?.stop();
  } catch {
    /* ignore shutdown errors during failed start */
  }
  process.exit(1);
});
