#!/usr/bin/env node
// Removes duplicate route blocks from legacy.ts that have been extracted
// into the split router modules under routes/legacy/*.ts.
//
// Each duplicate is matched by method + path and removed from the route
// signature line through its closing `});` (column 0). All extracted routes
// use block-style arrow handlers, so `});` at column 0 is a reliable end.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../packages/web-api/src/routes/legacy.ts', import.meta.url).pathname;

// (method, path) pairs extracted from routes/legacy/*.ts split modules.
const DUPLICATES = [
  // files.ts
  ['get', '/api/cwd'],
  ['get', '/api/cwd/default'],
  ['post', '/api/cwd'],
  ['get', '/api/filesystem/dirs'],
  ['post', '/api/files/upload'],
  ['get', '/api/files'],
  ['get', '/api/files/:id'],
  ['delete', '/api/files/:id'],
  // gateway.ts
  ['get', '/api/tui-active'],
  ['get', '/api/webui-active'],
  ['post', '/api/webui-active'],
  ['delete', '/api/webui-active'],
  ['get', '/api/gateway/status'],
  ['post', '/api/gateway/focus'],
  ['get', '/api/gateway/focus'],
  // mode.ts
  ['post', '/api/mode/hyperdrive'],
  ['get', '/api/mode/hyperdrive'],
  // orchestrator.ts
  ['post', '/api/orchestrator/plan'],
  ['post', '/api/orchestrator/plan/:id/execute'],
  // permission.ts
  ['post', '/api/permission/respond'],
  ['post', '/api/permission/instruct'],
  ['post', '/api/permission/respond-batch'],
  // plugins.ts
  ['get', '/api/plugins'],
  ['get', '/api/plugins/categories'],
  ['get', '/api/plugins/available'],
  ['get', '/api/plugins/installed'],
  ['post', '/api/plugins/:id/install'],
  ['post', '/api/plugins/:id/uninstall'],
  ['post', '/api/plugins/:id/toggle'],
  ['get', '/api/plugins/:id'],
  ['put', '/api/plugins/:id/config'],
  ['post', '/api/plugins/postgresql/test-connection'],
  ['get', '/api/plugins/postgresql/comparison'],
  // rag.ts
  ['get', '/api/rag/status'],
  ['post', '/api/rag/index'],
  ['post', '/api/rag/search'],
  ['delete', '/api/rag/documents/:id'],
  ['post', '/api/rag/clear'],
  // system.ts
  ['get', '/api/system/capabilities'],
  ['post', '/api/system/app-visibility'],
  ['get', '/api/setup/status'],
  ['post', '/api/setup/complete'],
  ['get', '/api/config'],
  ['get', '/api/runtime/status'],
  ['put', '/api/config'],
  ['get', '/api/metrics'],
  ['get', '/api/logs'],
  ['get', '/api/logs/stream'],
  ['delete', '/api/logs'],
  ['post', '/api/reset'],
  ['post', '/api/debug/log'],
  // todos.ts
  ['get', '/api/todos'],
  ['post', '/api/todos'],
  ['put', '/api/todos/:itemId'],
  // tools.ts
  ['get', '/api/tools'],
  ['post', '/api/tools/bulk-toggle'],
  ['get', '/api/tools/categories'],
  ['get', '/api/tools/:id'],
  ['put', '/api/tools/:id'],
];

const lines = readFileSync(FILE, 'utf-8').split('\n');
const remove = new Set(); // 0-based line indices to remove

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const [method, path] of DUPLICATES) {
  const startRe = new RegExp(`^r\\.${method}\\(['"]${escapeRe(path)}['"]`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (remove.has(i)) continue;
    if (startRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) {
    console.warn(`NOT FOUND: ${method.toUpperCase()} ${path}`);
    continue;
  }
  // Find closing `});` at column 0 (no leading whitespace).
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '});') { end = i; break; }
  }
  if (end === -1) {
    console.warn(`NO CLOSE FOUND for ${method.toUpperCase()} ${path} at line ${start + 1}`);
    continue;
  }
  for (let i = start; i <= end; i++) remove.add(i);
  // Also remove a single trailing blank line if present (avoid double blanks).
  if (lines[end + 1] === '') remove.add(end + 1);
  console.log(`removed ${method.toUpperCase()} ${path}: lines ${start + 1}-${end + 1}`);
}

const out = lines.filter((_, i) => !remove.has(i)).join('\n');
writeFileSync(FILE, out);
console.log(`\nRemoved ${remove.size} lines. New line count: ${out.split('\n').length}`);
