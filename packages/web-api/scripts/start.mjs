#!/usr/bin/env node
/**
 * Start the web API with embedded Postgres and Redis.
 *
 * This delegates to packages/runtime/scripts/start-services.mjs so the
 * services are started before the API process is spawned.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');
const webApiPath = resolve(__dirname, '..', 'dist', 'index.js');
const startServicesPath = resolve(__dirname, '..', '..', 'runtime', 'scripts', 'start-services.mjs');

const child = spawn('node', [startServicesPath, 'node', webApiPath], {
  stdio: 'inherit',
  env: process.env,
  cwd: rootDir,
});

child.on('error', (err) => {
  console.error('Failed to start web API:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
