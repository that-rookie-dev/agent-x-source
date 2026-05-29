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

  // Try candidate paths to find the web-api package
  const candidates = [
    // Monorepo sibling (dev from packages/cli/dist/)
    join(dirname(dirname(bundlePath)), '..', 'web-api'),
    // Monorepo from source root
    join(process.cwd(), 'packages', 'web-api'),
    // AGENTX_SOURCE env var
    process.env['AGENTX_SOURCE'] ? join(process.env['AGENTX_SOURCE'], 'packages', 'web-api') : null,
    // Installed alongside CLI bundle (~/.agentx/web-api/)
    join(dirname(bundlePath), 'web-api'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) { webApiDir = dir; break; }
  }
  if (!webApiDir) return; // web-api not available in this installation

  const builtScript = join(webApiDir, 'dist', 'index.js');
  const sourceScript = join(webApiDir, 'src', 'index.ts');

  let child;
  try {
    if (existsSync(builtScript)) {
      child = spawn(process.execPath, [builtScript], {
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
    child.on('error', () => { /* spawn failure — non-fatal */ });
    child.unref();
    for (let i = 0; i < 6; i++) {
      if (await isWebApiRunning()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch { /* non-fatal */ }
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
    removeCrashMarker();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    removeCrashMarker();
    process.exit(0);
  });

  const args = process.argv.slice(2);

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
        process.exit(0);
      }
    }

    // Auto-configure on first run if no config exists
    const configMgr = new ConfigManager();
    if (!configMgr.isConfigured()) {
      console.error('✗ Agent-X is not configured yet.\n');
      console.error('  Run `agentx` to launch the interactive setup first.');
      process.exit(1);
    }

    // If --token is provided, save it and proceed
    const telegramStore = new TelegramStore();
    if (inlineToken) {
      telegramStore.save({ botToken: inlineToken });
      console.log('✓ Telegram bot token saved.');
    }

    // Ensure web API (backend + static UI) is running so daemon and UI can interact
    await ensureWebApiRunning();

    // Check Telegram config
    const telegramConfig = telegramStore.load();
    if (!telegramConfig?.botToken) {
      console.error('✗ Telegram bot is not connected.\n');
      console.error('  To connect, get a bot token from @BotFather on Telegram, then run:\n');
      console.error('    agentx start --token <your-bot-token>\n');
      console.error('  Steps:');
      console.error('    1. Open Telegram and search for @BotFather');
      console.error('    2. Send /newbot and follow the prompts');
      console.error('    3. Copy the token (looks like: 123456789:ABCdefGhIjKlMnOpQrStUvWxYz)');
      console.error('    4. Run: agentx start --token <token>');
      process.exit(1);
    }

    // Spawn daemon as detached background process
    const daemonScript = join(dirname(new URL(import.meta.url).pathname), 'daemon.js');
    const child = spawn(process.execPath, [daemonScript, '--daemon'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AGENTX_DAEMON: '1' },
    });
    child.unref();
    // Wait briefly for daemon to start and write status
    await new Promise((r) => setTimeout(r, 2000));
    if (isDaemonRunning()) {
      const status = getDaemonStatus();
      console.log(`✦ Agent-X daemon started (PID: ${status.pid})`);
      console.log(`  Crew: ${status.crew ?? 'default'}`);
      if (status.telegram) console.log(`  Telegram: @${status.botUsername ?? 'connected'}`);
      const webOk = await isWebApiRunning();
      console.log(`  Web API: ${webOk ? 'running' : 'not running'}`);
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
      console.log('✦ Agent-X daemon: running');
      console.log(`  PID: ${status.pid}`);
      console.log(`  Crew: ${status.crew ?? 'unknown'}`);
      if (status.telegram) console.log(`  Telegram: @${status.botUsername ?? 'connected'}`);
      if (status.startedAt) console.log(`  Started: ${status.startedAt}`);
    }
    const webOk = await isWebApiRunning();
    console.log(`  Web API: ${webOk ? 'running' : 'not running'}`);
    process.exit(0);
  }

  // Check for crash recovery before starting
  const recovered = handleCrashRecovery();

  // Check for session restore
  let sessionId: string | undefined;
  const sessionIdx = args.indexOf('session');
  if (sessionIdx !== -1 && args[sessionIdx + 1]) {
    sessionId = args[sessionIdx + 1];
  }

  // Write crash marker (removed on clean exit)
  writeCrashMarker();

  // Clear terminal before launching
  process.stdout.write('\x1Bc');

  // Ensure backend is available for TUI features and the Web UI
  try { await ensureWebApiRunning(); } catch { /* non-fatal */ }

  // Render the TUI
  render(React.createElement(App, { sessionId, recovered }));
}

main().catch((err) => {
  console.error('\n✦ Agent-X fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
