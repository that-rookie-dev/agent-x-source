/**
 * Pack Agent-X server tarball for curl | bash installation.
 * Output: packages/server/release/agentx-{platform}-server.tar.gz
 */
import {
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');
const workspaceRoot = join(serverRoot, '..', '..');
const storeDir = join(workspaceRoot, 'node_modules', '.pnpm');

function getPlatformSuffix() {
  const os = platform();
  const cpu = arch();
  if (os === 'darwin') {
    return cpu === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (os === 'linux') {
    return cpu === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  if (os === 'win32') {
    return 'win-x64';
  }
  throw new Error(`Unsupported pack platform: ${os}/${cpu}`);
}

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

const suffix = getPlatformSuffix();
const staging = join(serverRoot, '.pack-staging');
const releaseDir = join(serverRoot, 'release');
const tarball = join(releaseDir, `agentx-${suffix}-server.tar.gz`);

console.log(`Packing Agent-X server for ${suffix}...`);

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
cpSync(join(serverRoot, 'scripts', 'agentx-cli.sh'), join(staging, 'agentx'), { mode: 0o755 });

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
  optionalDependencies: runtimePkg.optionalDependencies,
}, null, 2));

console.log('Installing production dependencies into staging...');
execSync('npm install --omit=dev --ignore-scripts', { cwd: staging, stdio: 'inherit' });

copyPgDeps(join(resourcesDir, 'web-api', 'node_modules'));

console.log(`Creating ${tarball}...`);
execSync(`tar -czf "${tarball}" -C "${staging}" .`, { stdio: 'inherit' });

rmSync(staging, { recursive: true, force: true });
console.log(`Server tarball ready: ${tarball}`);
