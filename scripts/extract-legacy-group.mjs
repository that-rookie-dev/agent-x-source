#!/usr/bin/env node
// Extracts a group of route blocks from legacy.ts and prints them (indented)
// so they can be pasted into a new split-module file. Also reports the line
// ranges so the companion removal script can delete them from legacy.ts.
//
// Usage: node scripts/extract-legacy-group.mjs <group.json>
// group.json: { "routes": [["post","/api/discord/start"], ["get","/api/discord/status"], ...] }
import { readFileSync } from 'node:fs';

const FILE = new URL('../packages/web-api/src/routes/legacy.ts', import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf-8'));

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const lines = readFileSync(FILE, 'utf-8').split('\n');
const blocks = [];

for (const [method, path] of cfg.routes) {
  const startRe = new RegExp(`^r\\.${method}\\(['"]${escapeRe(path)}['"]`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) { console.error(`NOT FOUND: ${method.toUpperCase()} ${path}`); process.exit(1); }
  let end = -1;
  const startTrimmed = lines[start].trim();
  // One-liner route: the entire registration is on a single line ending with `);`
  if (startTrimmed.endsWith(');') && !startTrimmed.includes('=> {')) {
    end = start;
  } else {
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i] === '});') { end = i; break; }
    }
  }
  if (end === -1) { console.error(`NO CLOSE for ${method.toUpperCase()} ${path}`); process.exit(1); }
  // Re-indent: add 2 spaces to each line (route body inside create*Router)
  const block = lines.slice(start, end + 1).map(l => l.length ? '  ' + l : l);
  blocks.push({ method, path, start: start + 1, end: end + 1, body: block.join('\n') });
}

// Print the extracted route bodies (indented for placement inside create*Router)
for (const b of blocks) {
  process.stdout.write(b.body + '\n\n');
}
process.stderr.write('\n--- line ranges (for removal) ---\n');
for (const b of blocks) {
  process.stderr.write(`${b.method.toUpperCase()} ${b.path}: ${b.start}-${b.end}\n`);
}
