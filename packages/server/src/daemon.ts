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
  runtime.setupPythonEnv();
  await runtime.start();

  const port = runtime.getPort();
  const url = resolvePublicUrl(port, process.env['AGENTX_PUBLIC_URL']);
  console.log(`Agent-X server running at ${url}`);
  console.log(`Listening on ${process.env['AGENTX_HOST'] ?? '127.0.0.1'}:${port}`);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

main().catch((err) => {
  console.error('Agent-X server failed to start:', err);
  process.exit(1);
});
