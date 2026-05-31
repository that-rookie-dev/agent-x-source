import React from 'react';
import { render } from 'ink';
import { VERSION, APP_NAME, TAGLINE, getLogger } from '@agentx/shared';
import { initSessionTrace } from './sessionTrace.js';
import { App } from '@agentx/tui';
import { ConfigManager, TelegramStore } from '@agentx/engine';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { isDaemonRunning, getDaemonStatus, stopDaemon } from './daemon.js';

async function isWebApiRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:3333/api/health', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureWebApiRunning(): Promise<void> {
  if (await isWebApiRunning()) return;

  let webApiDir: string | undefined;
  const bundlePath = new URL(import.meta.url).pathname;
  const bundleDir = dirname(bundlePath);

  // Build a list of candidate locations.
  const candidates = new Set<string>();
  const add = (p?: string | null) => { if (p) candidates.add(p); };

  // 1. Installed bundle sibling: ~/.agentx/web-api (release packages include web-api here)
  add(join(bundleDir, 'web-api'));

  // 2. Bundle parent tree: walk up from bundle to find a monorepo / project root
  let bcur = bundleDir;
  for (let i = 0; i < 6; i++) {
    add(join(bcur, 'packages', 'web-api'));
    add(join(bcur, 'source', 'packages', 'web-api'));
    add(join(bcur, 'web-api'));
    const next = dirname(bcur);
    if (!next || next === bcur) break;
    bcur = next;
  }

  // 3. CWD-based candidates (dev workflow)
  add(join(process.cwd(), 'packages', 'web-api'));
  add(join(process.cwd(), 'source', 'packages', 'web-api'));

  // 4. Environment override
  if (process.env['AGENTX_SOURCE']) add(join(process.env['AGENTX_SOURCE'], 'packages', 'web-api'));
  if (process.env['AGENTX_HOME']) add(join(process.env['AGENTX_HOME'], 'web-api'));

  // 5. Walk up from CWD
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    add(join(cur, 'packages', 'web-api'));
    add(join(cur, 'source', 'packages', 'web-api'));
    add(join(cur, 'web-api'));
    const next = dirname(cur);
    if (!next || next === cur) break;
    cur = next;
  }

  for (const dir of candidates) {
    try {
      if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'dist', 'index.js')) || existsSync(join(dir, 'server.js'))) {
        webApiDir = dir;
        break;
      }
    } catch { /* skip */ }
  }

  if (!webApiDir) {
    // Diagnostic: print searched paths to stderr so users can debug
    console.error('⚠ Web API not found. Searched:');
    for (const dir of candidates) console.error(`   ${dir}`);
    console.error('   Set AGENTX_SOURCE to the repo root if running from source.');
    return;
  }

  const builtScript = join(webApiDir, 'dist', 'index.js');
  const serverScript = join(webApiDir, 'server.js');
  const sourceScript = join(webApiDir, 'src', 'index.ts');

  let child;
  try {
    if (existsSync(builtScript)) {
      child = spawn(process.execPath, [builtScript], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, AGENTX_AUTO_STARTED: '1' },
      });
    } else if (existsSync(serverScript)) {
      child = spawn(process.execPath, [serverScript], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, AGENTX_AUTO_STARTED: '1' },
      });
    } else {
      const tsxPath = join(webApiDir, 'node_modules', '.bin', 'tsx');
      child = spawn(tsxPath, [sourceScript], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, AGENTX_AUTO_STARTED: '1' },
      });
    }
    child.on('error', (err) => {
      console.error(`⚠ Failed to spawn web-api: ${err.message}`);
    });
    child.unref();
    for (let i = 0; i < 10; i++) {
      if (await isWebApiRunning()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error('⚠ Web API process spawned but health check did not respond.');
  } catch (err) {
    console.error(`⚠ ensureWebApiRunning error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Crash marker — written on start, removed on clean exit */
function getCrashMarkerPath(): string {
  const home = homedir();
  const base = process.env['XDG_DATA_HOME']
    ? join(process.env['XDG_DATA_HOME'], 'agentx')
    : join(home, '.local', 'share', 'agentx');
  return join(base, '.crash_marker');
}

function writeCrashMarker(): void {
  try {
    const markerPath = getCrashMarkerPath();
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }));
  } catch { /* non-critical */ }
}

function removeCrashMarker(): void {
  try {
    const markerPath = getCrashMarkerPath();
    if (existsSync(markerPath)) unlinkSync(markerPath);
  } catch { /* non-critical */ }
}

function hadCrash(): boolean {
  return existsSync(getCrashMarkerPath());
}

/** Attempt config rollback if a crash was detected */
function handleCrashRecovery(): boolean {
  if (!hadCrash()) return false;

  const logger = getLogger();
  logger.warn('CRASH_RECOVERY', 'Crash marker detected from previous session');

  try {
    const configManager = new ConfigManager();
    const restored = configManager.restoreBackup();
    if (restored) {
      logger.info('CRASH_RECOVERY', 'Config restored from backup');
    }
  } catch (err) {
    logger.error('CRASH_RECOVERY', err);
  }

  removeCrashMarker();
  return true;
}

async function handleUninstall(): Promise<void> {
  const readline = await import('node:readline');
  const { rmSync } = await import('node:fs');

  const home = homedir();
  const configDir = process.env['XDG_CONFIG_HOME']
    ? join(process.env['XDG_CONFIG_HOME'], 'agentx')
    : join(home, '.config', 'agentx');
  const dataDir = process.env['XDG_DATA_HOME']
    ? join(process.env['XDG_DATA_HOME'], 'agentx')
    : join(home, '.local', 'share', 'agentx');
  const cacheDir = process.env['XDG_CACHE_HOME']
    ? join(process.env['XDG_CACHE_HOME'], 'agentx')
    : join(home, '.cache', 'agentx');
  const binDir = join(home, '.agentx');
  const binLink = join(home, '.local', 'bin', 'agentx');

  // Stop daemon if running
  if (isDaemonRunning()) {
    stopDaemon();
    console.log('  ✓ Daemon stopped');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  console.log('');
  console.log('✦ Agent-X Uninstall');
  console.log('');
  console.log('  This will remove the Agent-X binary from your system.');
  console.log('');
  console.log('  Your data includes:');
  console.log(`    • Config:      ${configDir}`);
  console.log(`    • Data/DB:     ${dataDir}`);
  console.log(`    • Cache/Logs:  ${cacheDir}`);
  console.log('');

  const answer = await ask('  Do you want to also delete all agent data? [y/N] ');
  const deleteData = answer.trim().toLowerCase() === 'y';

  rl.close();
  console.log('');

  // Remove binary
  try {
    if (existsSync(binDir)) rmSync(binDir, { recursive: true, force: true });
    if (existsSync(binLink)) unlinkSync(binLink);
    console.log('  ✓ Binary removed');
  } catch {
    console.log('  ⚠ Could not remove binary (try with sudo)');
  }

  if (deleteData) {
    try {
      if (existsSync(configDir)) rmSync(configDir, { recursive: true, force: true });
      console.log('  ✓ Config removed');
    } catch { console.log('  ⚠ Could not remove config directory'); }

    try {
      if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
      console.log('  ✓ Data removed');
    } catch { console.log('  ⚠ Could not remove data directory'); }

    try {
      if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
      console.log('  ✓ Cache removed');
    } catch { console.log('  ⚠ Could not remove cache directory'); }

    console.log('');
    console.log('  ✦ Agent-X fully uninstalled. All data cleared.');
  } else {
    console.log('  ✦ Agent-X uninstalled. Your data has been preserved.');
    console.log(`    To remove it later: rm -rf ${configDir} ${dataDir} ${cacheDir}`);
  }

  console.log('');
}

async function main(): Promise<void> {
  // Initialize session tracing (writes last N events to a single session file)
  try {
    initSessionTrace({ path: process.env.AGENTX_SESSION_TRACE_PATH ?? '/tmp/agentx-last-session.json', maxEvents: 50 });
  } catch {
    // non-fatal
  }

  const logger = getLogger();

  // Install global crash handlers
  process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT_EXCEPTION', err);
    console.error('\n✦ Agent-X encountered an error and will exit.');
    console.error(`  ${err.message}`);
    removeCrashMarker();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('UNHANDLED_REJECTION', reason instanceof Error ? reason : new Error(String(reason)));
    // Don't exit — let the app continue; the error is logged
  });

  // Clean exit handling
  process.on('exit', () => {
    removeCrashMarker();
  });
  process.on('SIGINT', () => {
    logger.info('SIGNAL', 'Received SIGINT — aborting cleanly');
    removeCrashMarker();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    logger.info('SIGNAL', 'Received SIGTERM — saving state and exiting');
    // Save crash recovery state for resume on next launch
    try {
      const { initSessionTrace } = await import('./session-trace.js');
      initSessionTrace({ path: '/tmp/agentx-last-session.json', maxEvents: 50 });
    } catch {
      // non-fatal
    }
    removeCrashMarker();
    process.exit(143);
  });

  // Terminal resize handling
  process.on('SIGWINCH', () => {
    // Ink handles re-layout internally; this prevents the process from exiting
    // on terminal resize and forces a stdout refresh
    if (process.stdout.isTTY) {
      process.stdout.emit('resize' as any);
    }
  });

  const args = process.argv.slice(2);

  // Check for --bg flag (background queue) early — used later to short-circuit and
  // run a single background command without launching the TUI. Declare it here
  // before any early usage to avoid temporal dead zone errors.
  const bgIdx = args.indexOf('--bg');
  const bgCommand = bgIdx !== -1 && args[bgIdx + 1] ? args.slice(bgIdx + 1).join(' ') : undefined;

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`✦ ${APP_NAME} v${VERSION}`);
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`✦ ${APP_NAME} v${VERSION} — ${TAGLINE}`);
    console.log('');
    console.log('Usage: agentx [command] [options]');
    console.log('');
    console.log('Commands:');
    console.log('  agentx                              Launch interactive TUI');
    console.log('  agentx start --token <bot-token>    Connect Telegram & start daemon');
    console.log('  agentx start                        Start daemon (if already connected)');
    console.log('  agentx stop                         Stop background daemon');
    console.log('  agentx status                       Show daemon status');
    console.log('  agentx session <id>                 Restore a previous session');
    console.log('');
    console.log('Options:');
    console.log('  --token <token>  Telegram bot token (from @BotFather)');
  console.log('  --plan           Start in plan mode (approve steps before execution)');
  console.log('  --fallback-model <model>  Fallback model if primary fails');
  console.log('  --max-budget <dollars>    Stop spending after this amount');
  console.log('  --git-auto-commit         Auto-commit after file edits');
  console.log('  --git-aware               Restrict scope to Git repo root');
  console.log('  --json                    JSON output mode (for CI/CD)');
  console.log('  --non-interactive         Non-interactive mode (for CI/CD)');
  console.log('  --allow-all-tools         Bypass all tool permission prompts (for CI/CD)');
  console.log('  --voice                   Record voice input before processing');
  console.log('  --prompt <text>           Prompt to process (for CI/CD mode)');
  console.log('  --cloud-login             Authenticate with Agent-X Cloud');
  console.log('  --cloud-list              List cloud sessions');
  console.log('  --teleport <prompt>       Run task on a cloud worker');
  console.log('  --resume-from-cloud <id>  Resume a cloud session');
  console.log('  --tunnel                  Start tunnel server (AGENTX_TUNNEL_PORT, AGENTX_TUNNEL_TOKEN)');
  console.log('  --connect <url>           Connect to a tunnel server');
  console.log('  -v, --version    Show version');
    console.log('  agentx uninstall                     Uninstall Agent-X');
    console.log('');
    console.log('Options:');
    console.log('  --token <token>  Telegram bot token (from @BotFather)');
    console.log('  -v, --version    Show version');
    console.log('  -h, --help       Show help');
    process.exit(0);
  }

  // ───── Uninstall command ─────

  if (args[0] === 'uninstall') {
    await handleUninstall();
    process.exit(0);
  }

  // ───── Daemon commands ─────

  if (args[0] === 'start') {
    // Parse --token flag
    const tokenIdx = args.indexOf('--token');
    const inlineToken = tokenIdx !== -1 ? args[tokenIdx + 1] : undefined;

    if (isDaemonRunning()) {
      const status = getDaemonStatus();
      // Auto-restart if running an older version
      if (status.version && status.version !== VERSION) {
        console.log(`✦ Agent-X updated (${status.version} → ${VERSION}). Restarting daemon...`);
        stopDaemon();
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        console.log(`✦ Agent-X daemon is already running (PID: ${status.pid})`);
        if (status.telegram) console.log(`  Telegram: @${status.botUsername ?? 'connected'}`);
        const webOk = await isWebApiRunning();
        if (webOk) console.log('  Web-UI: http://localhost:3333');
        process.exit(0);
      }
    }

    // If --token is provided, save it before starting the daemon
    if (inlineToken) {
      const telegramStore = new TelegramStore();
      telegramStore.save({ botToken: inlineToken });
      console.log('✓ Telegram bot token saved.');
    }

    // Spawn daemon as detached background process (daemon handles web-api + config checks)
    const daemonScript = join(dirname(new URL(import.meta.url).pathname), 'daemon.js');
    const child = spawn(process.execPath, [daemonScript, '--daemon'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENTX_DAEMON: '1' },
    });
    child.unref();

    // Wait briefly for daemon to start and write status, then poll for web-api
    await new Promise((r) => setTimeout(r, 1500));

    if (isDaemonRunning()) {
      const status = getDaemonStatus();
      console.log(`✦ Agent-X daemon started (PID: ${status.pid})`);
      if (status.crew) console.log(`  Crew: ${status.crew}`);
      if (status.telegram) console.log(`  Telegram: @${status.botUsername ?? 'connected'}`);

      // Poll web-api health for up to 4 seconds (it may need time to boot)
      let webOk = false;
      for (let i = 0; i < 8; i++) {
        webOk = await isWebApiRunning();
        if (webOk) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (webOk) {
        console.log('  Web-UI: http://localhost:3333');
      } else {
        console.log('  Web API: not running');
      }
    } else {
      console.error('✗ Daemon failed to start. Run `agentx` for diagnostics.');
    }
    process.exit(0);
  }

  if (args[0] === 'stop') {
    if (!isDaemonRunning()) {
      console.log('✦ Agent-X daemon is not running.');
      process.exit(0);
    }
    const status = getDaemonStatus();
    if (stopDaemon()) {
      console.log(`✦ Agent-X daemon stopped (was PID: ${status.pid})`);
    } else {
      console.error('✗ Failed to stop daemon.');
    }
    process.exit(0);
  }

  if (args[0] === 'status') {
    if (!isDaemonRunning()) {
      console.log('✦ Agent-X daemon: not running');
      console.log('  Use `agentx start` to launch the background agent.');
    } else {
      const status = getDaemonStatus();
      if (status.setupMode) {
        console.log('✦ Agent-X daemon: running (setup mode)');
      } else if (status.locked) {
        console.log('✦ Agent-X daemon: running (secure mode — login required)');
      } else {
        console.log('✦ Agent-X daemon: running');
      }
      console.log(`  PID: ${status.pid}`);
      console.log(`  Crew: ${status.crew ?? 'unknown'}`);
      if (status.telegram) console.log(`  Telegram: @${status.botUsername ?? 'connected'}`);
      if (status.discord) console.log(`  Discord: ${status.discordUsername ?? 'connected'}`);
      if (status.startedAt) {
        console.log(`  Started: ${status.startedAt}`);
        const elapsed = Date.now() - new Date(status.startedAt).getTime();
        const hrs = Math.floor(elapsed / 3600000);
        const mins = Math.floor((elapsed % 3600000) / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        const parts = [];
        if (hrs) parts.push(`${hrs}h`);
        if (mins) parts.push(`${mins}m`);
        parts.push(`${secs}s`);
        console.log(`  Uptime: ${parts.join(' ')}`);
      }
      const webOk = await isWebApiRunning();
      if (webOk) {
        console.log('  Web-UI: http://localhost:3333');
      } else {
        console.log('  Web API: not running');
      }
    }
    process.exit(0);
  }

  // Check for crash recovery before starting
  const recovered = handleCrashRecovery();

  // --bg flag: run a command in the background and exit
  if (bgCommand) {
    const { BackgroundQueue } = await import('@agentx/engine');
    const queue = new BackgroundQueue();
    const task = queue.enqueue(bgCommand, { timeout: 300_000 });
    const { execSync } = await import('node:child_process');
    try {
      execSync(bgCommand, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024, stdio: 'inherit' });
      console.log(`✦ Background task completed: ${bgCommand}`);
    } catch (err) {
      console.error(`✗ Background task failed: ${bgCommand}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Check for session restore
  let sessionId: string | undefined;
  const sessionIdx = args.indexOf('session');
  if (sessionIdx !== -1 && args[sessionIdx + 1]) {
    sessionId = args[sessionIdx + 1];
  }

  // Check for --plan flag
  const planMode = args.includes('--plan');

  // Check for --fallback-model flag
  const fallbackIdx = args.indexOf('--fallback-model');
  const fallbackModel = fallbackIdx !== -1 && args[fallbackIdx + 1] ? args[fallbackIdx + 1] : undefined;

  // Check for --max-budget flag
  const budgetIdx = args.indexOf('--max-budget');
  const maxBudget = budgetIdx !== -1 && args[budgetIdx + 1] ? parseFloat(args[budgetIdx + 1]) : undefined;

  // Check for git flags
  const gitAutoCommit = args.includes('--git-auto-commit');
  const gitAware = args.includes('--git-aware');


  // Check for CI/CD mode flags
  const jsonMode = args.includes('--json');
  const nonInteractive = args.includes('--non-interactive') || args.includes('--ci');
  const allowAllTools = args.includes('--allow-all-tools');
  const voiceFlag = args.includes('--voice');
  const teleportFlag = args.includes('--teleport');
  const resumeFlag = args.includes('--resume-from-cloud');
  const teleportIdx = args.indexOf('--teleport');
  const teleportPrompt = teleportIdx !== -1 && args[teleportIdx + 1] && !args[teleportIdx + 1]!.startsWith('--')
    ? args[teleportIdx + 1] : undefined;
  const resumeIdIdx = args.indexOf('--resume-from-cloud');
  const resumeId = resumeIdIdx !== -1 && args[resumeIdIdx + 1] ? args[resumeIdIdx + 1] : undefined;
  const cloudLogin = args.includes('--cloud-login');
  const cloudList = args.includes('--cloud-list');
  const tunnelFlag = args.includes('--tunnel');
  const connectFlag = args.includes('--connect');
  const connectUrl = connectFlag ? args[args.indexOf('--connect') + 1] : undefined;

  // Cloud handoff operations
  if (teleportFlag || resumeFlag || cloudLogin || cloudList) {
    const { CloudHandoff } = await import('@agentx/engine');
    const handoff = new CloudHandoff({
      endpoint: process.env['AGENTX_CLOUD_ENDPOINT'] ?? 'https://cloud.agentx.ai',
    });

    if (cloudLogin) {
      const ok = await handoff.getAuth().login(
        process.env['AGENTX_CLOUD_ENDPOINT'] ?? 'https://cloud.agentx.ai',
        process.env['AGENTX_CLOUD_API_KEY'],
      );
      if (ok) {
        console.log('✓ Logged in to Agent-X Cloud');
      } else {
        console.error('✗ Login failed. Set AGENTX_CLOUD_API_KEY or register at cloud.agentx.ai');
        process.exit(1);
      }
      process.exit(0);
    }

    if (!handoff.getAuth().isAuthenticated()) {
      console.error('Not authenticated to cloud. Run: agentx --cloud-login');
      process.exit(1);
    }

    if (cloudList) {
      const sessions = await handoff.listRemoteSessions();
      console.log('Cloud Sessions:');
      for (const s of sessions) {
        console.log(`  ${s.id}  [${s.status}]  ${s.prompt?.slice(0, 60) ?? 'N/A'}`);
      }
      process.exit(0);
    }

    if (resumeFlag && resumeId) {
      console.log(`Resuming cloud session ${resumeId}...`);
      const session = await handoff.resumeFromCloud(resumeId);
      if (session.status === 'completed') {
        console.log('Result:', session.result);
      } else if (session.status === 'failed') {
        console.error('Session failed:', session.error);
        process.exit(1);
      } else {
        console.log(`Session status: ${session.status}`);
      }
      process.exit(0);
    }

    if (teleportFlag && teleportPrompt) {
      console.log('Teleporting to cloud worker...');
      const session = await handoff.teleport(teleportPrompt);
      if (session.status === 'completed') {
        console.log('✓ Completed');
        console.log(session.result);
      } else if (session.status === 'failed') {
        console.error('✗ Failed:', session.error);
        process.exit(1);
      } else {
        console.log(`Session status: ${session.status}`);
      }
      process.exit(0);
    }

    console.error('Usage: agentx --teleport "your task" | --resume-from-cloud <session-id> | --cloud-login | --cloud-list');
    process.exit(1);
  }

  // Tunnel server mode
  if (tunnelFlag) {
    const { TunnelServer } = await import('@agentx/engine');
    const port = parseInt(process.env['AGENTX_TUNNEL_PORT'] ?? '8080', 10);
    const server = new TunnelServer({
      port,
      authToken: process.env['AGENTX_TUNNEL_TOKEN'],
    });
    console.log(`Starting tunnel server on port ${port}...`);
    await server.start();
    console.log(`✓ Tunnel server running at ${server.getUrl()}`);
    console.log(`  Auth token: ${server.getConfig().authToken.slice(0, 8)}...`);
    console.log('  Press Ctrl+C to stop');
    await new Promise(() => {});
  }

  // Tunnel client mode
  if (connectFlag) {
    if (!connectUrl) {
      console.error('Usage: agentx --connect <tunnel-url>');
      process.exit(1);
    }
    const { TunnelClient } = await import('@agentx/engine');
    const token = process.env['AGENTX_TUNNEL_TOKEN'] ?? '';
    console.log(`Connecting to tunnel: ${connectUrl}...`);
    const client = new TunnelClient({ url: connectUrl, token });
    client.setOnConnected((sessionId) => {
      console.log(`✓ Connected! Session: ${sessionId}`);
    });
    client.setOnMessage((data) => {
      console.log('Message:', data);
    });
    client.setOnDisconnected(() => {
      console.log('Disconnected from tunnel');
    });
    await client.connect();
    console.log('Connected. Waiting for messages...');
    await new Promise(() => {});
  }

  const promptArg = args.indexOf('--prompt') !== -1 ? args[args.indexOf('--prompt') + 1] : undefined;
  const taskArg = promptArg || args.find((a) => !a.startsWith('--') && args.indexOf(a) > 2) || (nonInteractive ? args.slice(2).join(' ') : undefined);

  // Write crash marker (removed on clean exit)
  writeCrashMarker();

  // CI/CD mode: non-interactive, JSON output
  if (jsonMode || nonInteractive) {
    // Ensure backend is available
    try { await ensureWebApiRunning(); } catch { /* non-fatal */ }
    const { Agent } = await import('@agentx/engine');
    const { ConfigManager } = await import('@agentx/engine');
    const { generateSessionId } = await import('@agentx/shared');
    const configMgr = new ConfigManager();
    const config = configMgr.load();
    const agent = new Agent({ config, sessionId: generateSessionId() });
    if (allowAllTools && agent.getToolExecutor()) {
      agent.getToolExecutor()!.getPermissionManager().allowAll();
    }

    let input = taskArg || '';

    // Voice input: record and transcribe
    if (voiceFlag) {
      try {
        const { execSync } = await import('node:child_process');
        const { writeFileSync, unlinkSync, existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const filePath = join(tmpdir(), `agentx-voice-${Date.now()}.wav`);
        const duration = 10;
        console.error(`Recording for ${duration}s...`);
        execSync(`rec -q -r 16000 -c 1 ${filePath} trim 0 ${duration}`, { stdio: 'pipe', timeout: 20000 });
        if (existsSync(filePath)) {
          const key = process.env.OPENAI_API_KEY;
          if (key) {
            console.error('Transcribing...');
          const { readFileSync } = await import('node:fs');
          const audioBuffer = readFileSync(filePath);
          const form = new FormData();
          form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
          form.append('model', 'whisper-1');
            const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}` },
              body: form as unknown as BodyInit,
            });
            const data = await res.json() as { text?: string };
            if (data.text) input = (input ? `${input}\n` : '') + data.text;
          }
          try { unlinkSync(filePath); } catch { /* ignore */ }
        }
      } catch (e) {
        console.error('Voice recording/transcription failed:', (e as Error).message);
      }
    }

    if (!input) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'No prompt provided. Usage: agentx --json --prompt "your task"' }));
      } else {
        console.error('No prompt provided. Usage: agentx --non-interactive --prompt "your task"');
      }
      process.exit(1);
    }

    if (jsonMode) {
      console.log(JSON.stringify({ status: 'processing', input }));
    }

    try {
      const result = await agent.processUserInput(input);
      if (jsonMode) {
        console.log(JSON.stringify({ status: 'complete', output: result.output, tokensUsed: agent.tokens.tokensUsed, totalCost: agent.tokens.totalCost }));
      } else {
        console.log(result.output);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (jsonMode) {
        console.log(JSON.stringify({ status: 'error', error: msg }));
      } else {
        console.error(msg);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // Clear terminal before launching TUI
  process.stdout.write('\x1Bc');

  // Render the TUI
  render(React.createElement(App, { sessionId, recovered, planMode, fallbackModel, maxBudget, gitAutoCommit, gitAware }));
}

main().catch((err) => {
  console.error('\n✦ Agent-X fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
