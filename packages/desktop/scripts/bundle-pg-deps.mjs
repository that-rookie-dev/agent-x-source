import { existsSync, cpSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

// scripts/ -> packages/desktop/ -> packages/ -> source/
const workspaceRoot = join(scriptDir, '..', '..', '..');
const storeDir = join(workspaceRoot, 'node_modules', '.pnpm');

const releaseDir = join(scriptDir, '..', 'release', 'mac-arm64');

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
