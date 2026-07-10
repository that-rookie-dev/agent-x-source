/**
 * Replace pnpm workspace symlinks with real files under packages/desktop so
 * electron-builder packs a self-contained production node_modules tree.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNativePostgres,
  findInPnpmStore,
  repairEmbeddedPostgresBinaries,
  requiredEmbeddedPackages,
  resolveTargetArch,
  resolveTargetPlatform,
  syncDarwinEmbeddedExtensions,
} from './embedded-postgres-pack.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(scriptDir, '..');
const rootDir = join(desktopDir, '..', '..');
const runtimeDir = join(rootDir, 'packages', 'runtime');
const desktopNodeModules = join(desktopDir, 'node_modules');
const pnpmStoreDir = join(rootDir, 'node_modules', '.pnpm');

const PG_DEPS = [
  'pg',
  'pg-cloudflare',
  'pg-connection-string',
  'pg-int8',
  'pg-pool',
  'pg-protocol',
  'pg-types',
  'pgpass',
  'postgres-array',
  'postgres-bytea',
  'postgres-date',
  'postgres-interval',
  'split2',
  'xtend',
];

function log(message) {
  console.log(`materialize-pack-deps: ${message}`);
}

function removeExtensionStaging(workDir) {
  for (const name of ['age-install', 'pgvector-install']) {
    const target = join(workDir, name);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      log(`removed ${target}`);
    }
  }
}

function materializePath(destPath, sourcePath) {
  if (!existsSync(sourcePath)) return;
  const resolved = realpathSync(sourcePath);
  if (resolved.startsWith(desktopDir) && !lstatSync(sourcePath).isSymbolicLink()) {
    return;
  }
  rmSync(destPath, { recursive: true, force: true });
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(resolved, destPath, { recursive: true, dereference: true });
  log(`materialized ${destPath.replace(desktopDir, '.')}`);
}

function materializeDistPackage(scopeDir, pkgName, sourceRoot) {
  const dest = join(desktopNodeModules, scopeDir, pkgName);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(sourceRoot, 'dist'), join(dest, 'dist'), { recursive: true });
  cpSync(join(sourceRoot, 'package.json'), join(dest, 'package.json'));
  log(`materialized @agentx/${pkgName} (dist only)`);
}

function materializePackageFromStore(pkgName, { required = false } = {}) {
  const src = findInPnpmStore(pnpmStoreDir, pkgName);
  if (!src) {
    const message = `could not find ${pkgName} in pnpm store`;
    if (required) throw new Error(`materialize-pack-deps: ${message}`);
    log(`warn: ${message}`);
    return;
  }
  const dest = pkgName.startsWith('@')
    ? join(desktopNodeModules, ...pkgName.split('/'))
    : join(desktopNodeModules, pkgName);
  materializePath(dest, src);
}

function materializePgTree() {
  for (const dep of PG_DEPS) {
    materializePackageFromStore(dep);
  }
}

function materializeSymlinksIn(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = realpathSync(full);
      if (!target.startsWith(desktopDir)) {
        materializePath(full, full);
      }
    } else if (entry.isDirectory() && entry.name !== '.bin') {
      materializeSymlinksIn(full);
    }
  }
}

function materializeEmbeddedPostgres() {
  const platform = resolveTargetPlatform();
  const arch = resolveTargetArch();
  const packages = requiredEmbeddedPackages(platform, arch);
  log(`target ${platform}/${arch} — materializing ${packages.join(', ') || '(none)'}`);

  for (const pkg of packages) {
    materializePackageFromStore(pkg, { required: true });
  }

  const embeddedScope = join(desktopNodeModules, '@embedded-postgres');
  if (existsSync(embeddedScope)) {
    for (const entry of readdirSync(embeddedScope)) {
      materializePath(join(embeddedScope, entry), join(embeddedScope, entry));
    }
  }

  materializePath(
    join(desktopNodeModules, 'embedded-postgres'),
    join(desktopNodeModules, 'embedded-postgres'),
  );

  if (platform === 'darwin') {
    syncDarwinEmbeddedExtensions(desktopNodeModules);
    log('synced macOS extension artifacts into darwin-x64 tree');
  }

  for (const pkg of packages) {
    repairEmbeddedPostgresBinaries(
      desktopNodeModules,
      pkg,
      platform === 'win32' ? 'win32' : platform,
    );
    assertNativePostgres(desktopNodeModules, pkg, platform === 'win32' ? 'win32' : platform);
  }
  log(`verified embedded PostgreSQL binaries for ${packages.join(', ')}`);
}

function main() {
  removeExtensionStaging(join(runtimeDir, '.pgvector-build'));
  removeExtensionStaging(join(desktopDir, '.pgvector-build'));

  if (!existsSync(desktopNodeModules)) {
    throw new Error(`Missing ${desktopNodeModules}. Run pnpm install from the repo root first.`);
  }

  materializeDistPackage('@agentx', 'runtime', runtimeDir);
  const sharedDest = join(desktopNodeModules, '@agentx', 'shared');
  if (existsSync(sharedDest)) {
    rmSync(sharedDest, { recursive: true, force: true });
    log('removed stale @agentx/shared (bundled in @agentx/runtime dist)');
  }
  materializePgTree();
  materializeEmbeddedPostgres();
  materializePackageFromStore('electron-updater');
  materializeSymlinksIn(desktopNodeModules);
  log('done');
}

main();
