#!/usr/bin/env node
/**
 * Start embedded Postgres and Redis, then run a given command.
 * Stops services automatically when the child exits or the process is killed.
 *
 * Usage: node start-services.mjs node ../web-api/dist/index.js
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PostgresLifecycleManager,
  RedisLifecycleManager,
  DEFAULT_EMBEDDED_PG_PORT,
  resolveDefaultServerDataDir,
} from '@agentx/runtime';
import { getLogger } from '@agentx/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dataDir = resolveDefaultServerDataDir();
mkdirSync(dataDir, { recursive: true });

const pgDataDir = join(dataDir, 'brain_db');
const redisDataDir = join(dataDir, 'redis');

const pgArgs = process.argv.slice(2);
if (pgArgs.length === 0) {
  getLogger().error('SERVICES', 'Usage: node start-services.mjs <command> [args...]');
  process.exit(1);
}

let pgManager = null;
let redisManager = null;
let child = null;
let stopping = false;

async function startServices() {
  pgManager = new PostgresLifecycleManager({
    dataDir: pgDataDir,
    port: DEFAULT_EMBEDDED_PG_PORT,
    host: '127.0.0.1',
    user: 'agentx',
    password: 'agentx',
    database: 'agentx',
    onLog: (msg) => getLogger().info('PG', msg),
    onError: (msg) => getLogger().error('PG', msg),
  });

  redisManager = new RedisLifecycleManager({
    dataDir: redisDataDir,
    port: 6379,
    host: '127.0.0.1',
    onLog: (msg) => getLogger().info('REDIS', msg),
    onError: (msg) => getLogger().error('REDIS', msg),
  });

  const connectionString = await pgManager.start();
  process.env['AGENTX_POSTGRES_CONNECTION_STRING'] = connectionString;
  process.env['AGENTX_EMBEDDED_PG_ENABLED'] = '1';
  process.env['AGENTX_DATA_DIR'] = dataDir;
  getLogger().info('SERVICES', `Postgres ready: ${connectionString}`);

  const redisUrl = await redisManager.start();
  if (redisUrl) {
    process.env['REDIS_URL'] = redisUrl;
    getLogger().info('SERVICES', `Redis ready: ${redisUrl}`);
  }
}

async function stopServices() {
  if (stopping) return;
  stopping = true;
  getLogger().info('SERVICES', 'Stopping embedded services...');
  try {
    if (pgManager) await pgManager.stop();
  } catch (e) {
    getLogger().error('SERVICES', `Postgres stop error: ${e instanceof Error ? e.message : e}`);
  }
  try {
    if (redisManager) await redisManager.stop();
  } catch (e) {
    getLogger().error('SERVICES', `Redis stop error: ${e instanceof Error ? e.message : e}`);
  }
}

function startChild() {
  child = spawn(pgArgs[0], pgArgs.slice(1), { stdio: 'inherit', env: process.env });

  child.on('close', async (code) => {
    await stopServices();
    process.exit(code ?? 0);
  });

  child.on('error', async (err) => {
    getLogger().error('SERVICES', `Child process error: ${err.message}`);
    await stopServices();
    process.exit(1);
  });
}

async function shutdown(signal) {
  if (stopping) return;
  if (child) {
    child.kill(signal);
  }
  await stopServices();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServices()
  .then(startChild)
  .catch(async (err) => {
    getLogger().error('SERVICES', `Failed to start services: ${err instanceof Error ? err.message : err}`);
    await stopServices();
    process.exit(1);
  });
