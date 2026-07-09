/**
 * Pack Agent-X server tarball for curl | bash installation.
 * Output: packages/server/release/agentx-{platform}-server.tar.gz
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { platform, arch } from 'node:os';
import { copyVoiceSidecarResources } from '../../voice-sidecar/scripts/copy-voice-resources.mjs';
import {
  assertNativePostgres,
  assertPgVectorExtension,
  assertPostgresSharedLibs,
  packageForSuffix,
  resolveBuiltEmbeddedPkgRoot,
  resolveExtensionDonorNative,
  resolvePackSuffix,
  syncEmbeddedExtensions,
} from '../../desktop/scripts/embedded-postgres-pack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');
const workspaceRoot = join(serverRoot, '..', '..');
const storeDir = join(workspaceRoot, 'node_modules', '.pnpm');
const IS_WIN = platform() === 'win32';

function copyPgDeps(webApiNodeModules) {
  if (!existsSync(storeDir)) {
    console.warn('pnpm store not found; skipping pg dep bundling');
    return;
  }

  const neededPrefixes = [
    'bindings@', 'file-uri-to-path@',
    'pg@', 'pg-connection-string@', 'pg-pool@', 'pg-protocol@', 'pg-types@',
    'pg-int8@', 'pgpass@', 'postgres-array@', 'postgres-bytea@', 'postgres-date@',
    'postgres-interval@', 'split2@', 'xtend@',
  ];

  mkdirSync(webApiNodeModules, { recursive: true });

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
}

function syncServerExtensions(suffix, stagingNodeModules, packPlatform) {
  const pkgName = packageForSuffix(suffix);
  const stagingNative = join(stagingNodeModules, ...pkgName.split('/'), 'native');
  const donorNative = resolveExtensionDonorNative(workspaceRoot, storeDir, suffix, packPlatform);

  if (!donorNative) {
    throw new Error(
      `Could not find pgvector artifacts for ${suffix}. `
      + 'Run pnpm --filter @agentx/runtime run setup:extensions before pack:server.',
    );
  }

  syncEmbeddedExtensions(donorNative, stagingNative, packPlatform);
  console.log(`Synced extension artifacts from ${donorNative} into server ${suffix} tree`);

  assertPgVectorExtension(stagingNative, packPlatform);
  console.log(`Verified pgvector extension in ${stagingNative}`);
}

function resolveEmbeddedPkgSource(embeddedPkg, packPlatform) {
  return resolveBuiltEmbeddedPkgRoot(workspaceRoot, storeDir, embeddedPkg, packPlatform);
}

function materializeWorkspacePkg(stagingNodeModules, pkgName, srcRoot) {
  const dest = join(stagingNodeModules, ...pkgName.split('/'));
  if (existsSync(join(dest, 'package.json'))) return;

  const pkgJson = join(srcRoot, 'package.json');
  const distDir = join(srcRoot, 'dist');
  if (!existsSync(pkgJson) || !existsSync(distDir)) {
    throw new Error(`Missing built package at ${srcRoot}. Run pnpm run build:deps first.`);
  }

  mkdirSync(dirname(dest), { recursive: true });
  mkdirSync(dest, { recursive: true });
  cpSync(pkgJson, join(dest, 'package.json'));
  cpSync(distDir, join(dest, 'dist'), { recursive: true });
  console.log(`Materialized ${pkgName} into server pack`);
}

function materializeEmbeddedPkg(stagingNodeModules, embeddedPkg, packPlatform) {
  const dest = join(stagingNodeModules, ...embeddedPkg.split('/'));
  const src = resolveEmbeddedPkgSource(embeddedPkg, packPlatform);
  if (!src) {
    if (!existsSync(join(dest, 'package.json'))) {
      throw new Error(
        `Could not resolve ${embeddedPkg} for server pack. `
        + 'On macOS arm64 runners packing darwin-x64, run pnpm install with '
        + '--config.supportedArchitectures.cpu=arm64,x64 --config.supportedArchitectures.os=darwin first.',
      );
    }
    console.warn(`Using npm-installed ${embeddedPkg}; local build tree not found`);
    assertNativePostgres(stagingNodeModules, embeddedPkg, packPlatform);
    assertPostgresSharedLibs(stagingNodeModules, embeddedPkg, packPlatform);
    return;
  }

  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`Materialized ${embeddedPkg} from ${src}`);

  assertNativePostgres(stagingNodeModules, embeddedPkg, packPlatform);
  assertPostgresSharedLibs(stagingNodeModules, embeddedPkg, packPlatform);
}

const suffix = resolvePackSuffix(platform(), arch());
const embeddedPkg = packageForSuffix(suffix);
if (!embeddedPkg) {
  throw new Error(`No embedded PostgreSQL package mapped for suffix ${suffix}`);
}

const packPlatform = suffix.startsWith('win') ? 'win32' : suffix.split('-')[0];
const staging = join(serverRoot, '.pack-staging');
const releaseDir = join(serverRoot, 'release');
const tarball = join(releaseDir, `agentx-${suffix}-server.tar.gz`);

console.log(`Packing Agent-X server for ${suffix} (${embeddedPkg})...`);

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

const resourcesDir = join(staging, 'resources');
mkdirSync(resourcesDir, { recursive: true });

const webApiDist = join(workspaceRoot, 'packages', 'web-api', 'dist');
const webUiDist = join(workspaceRoot, 'packages', 'web-ui', 'dist');
const webNeuronDist = join(workspaceRoot, 'packages', 'web-neuron', 'dist');
const pythonDir = join(workspaceRoot, 'packages', 'runtime', 'python');
const daemonJs = join(serverRoot, 'dist', 'daemon.js');

for (const [label, src, dest] of [
  ['web-api', webApiDist, join(resourcesDir, 'web-api')],
  ['web-ui', webUiDist, join(resourcesDir, 'web-ui')],
  ['web-neuron', webNeuronDist, join(resourcesDir, 'web-neuron')],
]) {
  if (!existsSync(src)) {
    throw new Error(`Missing ${label} build at ${src}. Run pnpm run build:deps first.`);
  }
  cpSync(src, dest, { recursive: true });
}

if (existsSync(pythonDir)) {
  cpSync(pythonDir, join(resourcesDir, 'python'), { recursive: true });
} else {
  console.warn('Python bundle not found; server will use system Python if available.');
}

copyVoiceSidecarResources(resourcesDir, { requireBundled: true });
console.log('Bundled voice-sidecar resources into server package');

if (!existsSync(daemonJs)) {
  throw new Error(`Missing server daemon at ${daemonJs}. Run pnpm --filter @agentx/server run build first.`);
}

cpSync(daemonJs, join(staging, 'index.js'));
const agentxDest = join(staging, IS_WIN ? 'agentx.cmd' : 'agentx');
if (IS_WIN) {
  writeFileSync(agentxDest, '@echo off\r\nnode "%~dp0index.js" %*\r\n');
} else {
  cpSync(join(serverRoot, 'scripts', 'agentx-cli.sh'), agentxDest);
  chmodSync(agentxDest, 0o755);
}

const runtimePkg = JSON.parse(
  readFileSync(join(workspaceRoot, 'packages', 'runtime', 'package.json'), 'utf-8'),
);

writeFileSync(join(staging, 'package.json'), JSON.stringify({
  name: 'agentx-server',
  private: true,
  version: runtimePkg.version,
  type: 'commonjs',
  dependencies: {
    'embedded-postgres': runtimePkg.dependencies['embedded-postgres'],
    pg: runtimePkg.dependencies.pg,
  },
}, null, 2));

console.log('Installing production dependencies into staging...');
execSync('npm install --omit=dev --ignore-scripts', { cwd: staging, stdio: 'inherit' });

const stagingNodeModules = join(staging, 'node_modules');
materializeWorkspacePkg(stagingNodeModules, '@agentx/runtime', join(workspaceRoot, 'packages', 'runtime'));
materializeEmbeddedPkg(stagingNodeModules, embeddedPkg, packPlatform);
syncServerExtensions(suffix, stagingNodeModules, packPlatform);

copyPgDeps(join(resourcesDir, 'web-api', 'node_modules'));

console.log(`Creating ${tarball}...`);
const tarballName = `agentx-${suffix}-server.tar.gz`;
execSync(`tar -czf "../release/${tarballName}" .`, { cwd: staging, stdio: 'inherit' });

rmSync(staging, { recursive: true, force: true });
console.log(`Server tarball ready: ${tarball}`);
