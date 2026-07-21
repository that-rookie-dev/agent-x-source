#!/usr/bin/env node
/**
 * Offline retrieval eval CLI — prints metrics and exits non-zero on Precision@5 regression.
 * Prefer: pnpm exec vitest run packages/engine/tests/retrieval
 * This script mirrors the CI gate for local/ops use.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--run', 'packages/engine/tests/retrieval'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
