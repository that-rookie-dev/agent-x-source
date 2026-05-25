import React from 'react';
import { render } from 'ink';
import { VERSION, APP_NAME, TAGLINE, getLogger } from '@agentx/shared';
import { App } from '@agentx/tui';
import { ConfigManager, TelegramStore } from '@agentx/engine';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { isDaemonRunning, getDaemonStatus, stopDaemon } from './daemon.js';

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

async function main(): Promise<void> {
  const logger = getLogger();

  // Install global crash handlers
  process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT_EXCEPTION', err);
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
    console.log('  -h, --help       Show help');
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
      console.log(`  Profile: ${status.profile ?? 'default'}`);
      if (status.telegram) console.log(`  Telegram: @${status.botUsername ?? 'connected'}`);
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
      process.exit(0);
    }
    const status = getDaemonStatus();
    console.log('✦ Agent-X daemon: running');
    console.log(`  PID: ${status.pid}`);
    console.log(`  Profile: ${status.profile ?? 'unknown'}`);
    if (status.telegram) console.log(`  Telegram: @${status.botUsername ?? 'connected'}`);
    if (status.startedAt) console.log(`  Started: ${status.startedAt}`);
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

  // Render the TUI
  render(React.createElement(App, { sessionId, recovered }));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
