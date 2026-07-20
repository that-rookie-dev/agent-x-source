#!/usr/bin/env node
// Removes a group of route blocks from legacy.ts by method+path.
// Usage: node scripts/remove-legacy-group.mjs <group.json>
import { readFileSync, writeFileSync } from 'node:fs';
const FILE = new URL('../packages/web-api/src/routes/legacy.ts', import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const lines = readFileSync(FILE, 'utf-8').split('\n');
const remove = new Set();
for (const [method, path] of cfg.routes) {
  const startRe = new RegExp(`^r\\.${method}\\(['"]${escapeRe(path)}['"]`);
  // Remove ALL matching blocks for this method+path (handles pre-existing
  // duplicate registrations where only the first is live).
  for (let s = 0; s < lines.length; s++) {
    if (remove.has(s)) continue;
    if (!startRe.test(lines[s])) continue;
    const start = s;
    let end = -1;
    const startTrimmed = lines[start].trim();
    if (startTrimmed.endsWith(');') && !startTrimmed.includes('=> {')) {
      end = start;
    } else {
      for (let i = start + 1; i < lines.length; i++) { if (lines[i] === '});') { end = i; break; } }
    }
    if (end === -1) { console.warn(`NO CLOSE: ${method.toUpperCase()} ${path}`); break; }
    for (let i = start; i <= end; i++) remove.add(i);
    if (lines[end + 1] === '') remove.add(end + 1);
    console.log(`removed ${method.toUpperCase()} ${path}: ${start + 1}-${end + 1}`);
  }
}
const out = lines.filter((_, i) => !remove.has(i)).join('\n');
writeFileSync(FILE, out);
console.log(`Removed ${remove.size} lines. New count: ${out.split('\n').length}`);
