#!/usr/bin/env node
/**
 * Start Agent-X in server mode.
 * This wraps the built server entry and handles graceful shutdown.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { start } = require('../dist/index.js');

start().catch((err) => {
  console.error('Agent-X server failed to start:', err);
  process.exit(1);
});
