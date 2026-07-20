#!/usr/bin/env node
/**
 * Dev runner: starts embedded PostgreSQL + web-api from source.
 * Logs go to stdout and to ~/.local/share/agentx/logs/dev-run.log
 *
 * Usage:
 *   pnpm exec tsx dev-run.mjs            # start
 *   Ctrl-C                               # stop both
 */
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = join(homedir(), '.local', 'share', 'agentx', 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = join(LOG_DIR, 'dev-run.log');

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try { appendFileSync(LOG_FILE, stamped + '\n'); } catch {}
}

// Start embedded PostgreSQL via PostgresLifecycleManager
const { PostgresLifecycleManager } = await import('./packages/runtime/src/PostgresLifecycleManager.ts');

const pg = new PostgresLifecycleManager({
  dataDir: join(homedir(), '.local', 'share', 'agentx', 'pg-data'),
  port: 3335,
  host: '127.0.0.1',
  user: 'agentx',
  password: 'agentx',
  database: 'agentx',
  onLog: (msg) => log('[PG] ' + msg),
  onWarn: (msg) => log('[PG WARN] ' + msg),
  onError: (msg) => log('[PG ERROR] ' + msg),
});

let apiChild = null;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Shutting down...');
  if (apiChild) {
    try { apiChild.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { apiChild.kill('SIGKILL'); } catch {} }, 3000);
  }
  try { await pg.stop(); } catch (e) { log('PG stop error: ' + e); }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  log('=== Starting Agent-X dev run ===');
  log('Log file: ' + LOG_FILE);

  log('Starting embedded PostgreSQL on 127.0.0.1:3335...');
  const connectionString = await pg.start();
  log('PG ready: ' + connectionString.replace(/:[^@]+@/, ':***@'));

  log('Starting web-api on 127.0.0.1:3333...');
  const env = {
    ...process.env,
    AGENTX_POSTGRES_CONNECTION_STRING: connectionString,
    AGENTX_UI_DIR: join(process.cwd(), 'packages', 'web-ui', 'dist'),
    PORT: '3333',
    NODE_ENV: 'production',
  };
  apiChild = spawn('node', ['packages/web-api/dist/index.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiChild.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) log('[API] ' + line);
    }
  });
  apiChild.stderr.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) log('[API ERR] ' + line);
    }
  });
  apiChild.on('exit', (code, signal) => {
    log(`API exited code=${code} signal=${signal}`);
    if (!shuttingDown) shutdown();
  });

  log('Dev run active. Press Ctrl-C to stop.');
  // Keep alive
  setInterval(() => {}, 1000);
}

main().catch((e) => { log('FATAL: ' + e); shutdown(); });
