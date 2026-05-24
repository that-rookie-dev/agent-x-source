import React from 'react';
import { render } from 'ink';
import { VERSION, APP_NAME, TAGLINE, getLogger } from '@agentx/shared';
import { App } from '@agentx/tui';
import { ConfigManager } from '@agentx/engine';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

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

function main(): void {
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
    console.log('Usage: agentx [options] [session <id>]');
    console.log('');
    console.log('Options:');
    console.log('  -v, --version    Show version');
    console.log('  -h, --help       Show help');
    console.log('');
    console.log('Commands:');
    console.log('  agentx                  Launch agent (setup wizard if not configured)');
    console.log('  agentx session <id>     Restore a previous session');
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

main();
