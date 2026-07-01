import { existsSync, cpSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

// scripts/ -> packages/desktop/ -> packages/ -> source/
const workspaceRoot = join(scriptDir, '..', '..', '..');
const storeDir = join(workspaceRoot, 'node_modules', '.pnpm');

// Detect the release directory — electron-builder outputs to mac-<arch>
// (e.g. mac-arm64, mac-x64). Find whichever exists.
const releaseBase = join(scriptDir, '..', 'release');
let releaseDir = null;
for (const name of readdirSync(releaseBase)) {
  if (name.startsWith('mac-')) {
    const candidate = join(releaseBase, name);
    if (existsSync(join(candidate, 'Agent-X.app'))) {
      releaseDir = candidate;
      break;
    }
  }
}
if (!releaseDir) {
  console.error('Could not find mac-* release directory with Agent-X.app');
  process.exit(1);
}
console.log('Bundle PG deps for release:', releaseDir);

if (!existsSync(storeDir)) {
  console.error('pnpm store not found at', storeDir);
  process.exit(1);
}

const neededPrefixes = [
  'bindings@', 'file-uri-to-path@',
  'pg@', 'pg-connection-string@', 'pg-pool@', 'pg-protocol@', 'pg-types@',
  'pg-int8@', 'pgpass@', 'postgres-array@', 'postgres-bytea@', 'postgres-date@',
  'postgres-interval@', 'split2@', 'xtend@',
];

const appDir = join(releaseDir, 'Agent-X.app');
const webApiNodeModules = join(appDir, 'Contents', 'Resources', 'web-api', 'node_modules');

if (!existsSync(webApiNodeModules)) {
  mkdirSync(webApiNodeModules, { recursive: true });
}

for (const entry of readdirSync(storeDir)) {
  for (const prefix of neededPrefixes) {
    if (entry.startsWith(prefix)) {
      const dep = prefix.slice(0, -1);
      const src = join(storeDir, entry, 'node_modules', dep);
      if (existsSync(src)) {
        const dest = join(webApiNodeModules, dep);
        if (!existsSync(dest)) {
          cpSync(src, dest, { recursive: true, force: true });
          console.log('bundled dependency:', dep);
        }
      }
      break;
    }
  }
}
