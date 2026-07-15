#!/usr/bin/env node
/**
 * Dev helper for desktop: build deps and launch via dev-desktop.sh.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const devScript = resolve(__dirname, '..', '..', '..', 'scripts', 'dev-desktop.sh');

const child = spawn('bash', [devScript], { stdio: 'inherit', env: process.env });

child.on('error', (err) => {
  console.error('Failed to start desktop dev:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
