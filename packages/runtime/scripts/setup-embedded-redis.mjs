/**
 * Build or fetch a portable redis-server binary for the target platform.
 *
 * Supports:
 *   - macOS arm64 / x64  (compiled from source with BUILD_TLS=no, MALLOC=libc)
 *   - Linux arm64 / x64  (compiled from source with BUILD_TLS=no, MALLOC=libc)
 *   - Windows x64        (prebuilt msys2 binary from redis-windows)
 *
 * Output is mirrored to packages/runtime/redis and packages/desktop/redis so
 * electron-builder extraResources can copy it into the packaged app.
 *
 * Honours TARGET_PLATFORM / TARGET_ARCH for cross-arch desktop packs.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch as hostArch, cpus, platform as hostPlatform } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as tar from 'tar';
import extractZip from 'extract-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_OUT = join(__dirname, '..', 'redis');
const DESKTOP_OUT = join(__dirname, '..', '..', 'desktop', 'redis');

const REDIS_VERSION = process.env.REDIS_VERSION || '7.4.9';
const SOURCE_URL = `https://download.redis.io/releases/redis-${REDIS_VERSION}.tar.gz`;
const WIN_URL = `https://github.com/redis-windows/redis-windows/releases/download/${REDIS_VERSION}/Redis-${REDIS_VERSION}-Windows-x64-msys2-with-Service.zip`;

const WIN_DLLS = [
  'msys-2.0.dll',
  'msys-crypto-3.dll',
  'msys-gcc_s-seh-1.dll',
  'msys-ssl-3.dll',
  'msys-stdc++-6.dll',
];

function normalizeArch(value) {
  const v = String(value || '').toLowerCase();
  return v.includes('arm') || v === 'aarch64' ? 'arm64' : 'x64';
}

function normalizePlatform(value) {
  const p = String(value || '').toLowerCase();
  if (p === 'mac' || p === 'macos' || p === 'darwin') return 'darwin';
  if (p === 'win' || p === 'windows' || p === 'win32') return 'win32';
  if (p === 'linux') return 'linux';
  return p;
}

function resolveTargetKey() {
  const rawPlatform = process.env.TARGET_PLATFORM
    || process.env.npm_config_platform
    || hostPlatform();
  const rawArch = process.env.TARGET_ARCH
    || process.env.ARCH
    || process.env.npm_config_arch
    || hostArch();
  const platform = normalizePlatform(rawPlatform);
  const cpu = normalizeArch(rawArch);
  if (platform === 'darwin') return `darwin-${cpu}`;
  if (platform === 'linux') return `linux-${cpu}`;
  if (platform === 'win32') return 'win32-x64';
  return null;
}

function canExecuteTarget(key) {
  const hostKey = `${normalizePlatform(hostPlatform())}-${normalizeArch(hostArch())}`;
  return hostKey === key || (hostKey === 'win32-x64' && key === 'win32-x64');
}

function binaryName(key) {
  return key.startsWith('win32') ? 'redis-server.exe' : 'redis-server';
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText} (${url})`);
  if (!res.body) throw new Error(`Empty response body for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

function findSingleDir(parentDir) {
  const entries = readdirSync(parentDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length !== 1) {
    throw new Error(`Expected a single extracted directory in ${parentDir}, found ${dirs.length}`);
  }
  return join(parentDir, dirs[0].name);
}

function clearMacQuarantine(filePath) {
  if (hostPlatform() !== 'darwin') return;
  try {
    execSync(`xattr -cr "${filePath}"`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    execSync(`codesign --force --sign - "${filePath}"`, { stdio: 'ignore' });
  } catch {
    /* ignore — unsigned hosts may still run the binary */
  }
}

function compileRedis(sourceDir, key) {
  // GNU Make's implicit C rule uses $(TARGET_ARCH) as a bare compiler flag.
  // electron-builder sets it to x64|arm64, which would break compilation.
  delete process.env.TARGET_ARCH;

  const [platform, cpu] = key.split('-');
  const env = { ...process.env, BUILD_TLS: 'no', MALLOC: 'libc' };

  if (platform === 'darwin') {
    const archFlag = cpu === 'arm64' ? 'arm64' : 'x86_64';
    env.CFLAGS = env.CFLAGS ? `${env.CFLAGS} -arch ${archFlag}` : `-arch ${archFlag}`;
    env.LDFLAGS = env.LDFLAGS ? `${env.LDFLAGS} -arch ${archFlag}` : `-arch ${archFlag}`;
  }

  if (platform === 'linux' && cpu !== normalizeArch(hostArch()) && hostPlatform() === 'linux') {
    throw new Error(
      `Cross-arch Linux builds (${key}) are not supported by this script. `
      + 'Build on a Linux runner with the target architecture, or use a cross toolchain.',
    );
  }

  const make = process.platform === 'win32' ? 'nmake' : 'make';
  const result = spawnSync(make, [`-j${cpus().length}`], {
    cwd: sourceDir,
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`redis build failed for ${key} (make exit ${result.status ?? 'signal'})`);
  }
}

function verifyRedis(binPath, key) {
  if (!canExecuteTarget(key)) {
    console.log(`Skipping redis --version (cross-target ${key} on ${hostPlatform()}-${hostArch()})`);
    return;
  }
  const result = spawnSync(binPath, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `Bundled redis-server failed --version (status ${result.status}): ${result.stderr || result.stdout || 'no output'}`,
    );
  }
  const first = (result.stdout || '').split('\n')[0] || '';
  console.log(`Verified: ${first}`);
}

function installBinary(sourceBin, outDir, binName) {
  const binDir = join(outDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const dest = join(binDir, binName);
  copyFileSync(sourceBin, dest);
  if (!binName.endsWith('.exe')) {
    chmodSync(dest, 0o755);
    clearMacQuarantine(dest);
  }
  return dest;
}

async function buildRedisSource(key) {
  const workDir = join(__dirname, '..', '.redis-download');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const archive = join(workDir, 'redis.tar.gz');
  console.log(`Downloading Redis ${REDIS_VERSION} source for ${key}…`);
  console.log(`  ${SOURCE_URL}`);
  await downloadFile(SOURCE_URL, archive);

  const extractDir = join(workDir, 'extracted');
  mkdirSync(extractDir, { recursive: true });
  await tar.x({ file: archive, cwd: extractDir });

  const sourceDir = findSingleDir(extractDir);
  console.log(`Compiling Redis for ${key}…`);
  compileRedis(sourceDir, key);

  const binName = binaryName(key);
  const sourceBin = join(sourceDir, 'src', binName);
  if (!existsSync(sourceBin)) {
    throw new Error(`Compiled redis binary not found at ${sourceBin}`);
  }

  const runtimeBin = installBinary(sourceBin, RUNTIME_OUT, binName);
  verifyRedis(runtimeBin, key);

  rmSync(workDir, { recursive: true, force: true });
}

async function buildRedisWindows() {
  const workDir = join(__dirname, '..', '.redis-download');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const archive = join(workDir, 'redis.zip');
  console.log(`Downloading Redis ${REDIS_VERSION} for Windows x64…`);
  console.log(`  ${WIN_URL}`);
  await downloadFile(WIN_URL, archive);

  const extractDir = join(workDir, 'extracted');
  mkdirSync(extractDir, { recursive: true });
  await extractZip(archive, { dir: resolve(extractDir) });

  const sourceDir = findSingleDir(extractDir);
  const binDir = join(RUNTIME_OUT, 'bin');
  mkdirSync(binDir, { recursive: true });

  const exeSource = join(sourceDir, 'redis-server.exe');
  if (!existsSync(exeSource)) {
    throw new Error(`redis-server.exe not found in ${sourceDir}`);
  }
  copyFileSync(exeSource, join(binDir, 'redis-server.exe'));

  for (const dll of WIN_DLLS) {
    const dllSource = join(sourceDir, dll);
    if (existsSync(dllSource)) {
      copyFileSync(dllSource, join(binDir, dll));
    } else {
      console.warn(`Optional DLL not found: ${dll}`);
    }
  }

  console.log(`Verified: redis-server.exe + ${WIN_DLLS.length} msys2 DLLs staged`);
  rmSync(workDir, { recursive: true, force: true });
}

function mirrorToDesktop() {
  if (!existsSync(dirname(DESKTOP_OUT))) {
    console.warn(`Desktop dir not found at ${dirname(DESKTOP_OUT)}; skipping mirror`);
    return;
  }
  rmSync(DESKTOP_OUT, { recursive: true, force: true });
  cpSync(RUNTIME_OUT, DESKTOP_OUT, { recursive: true, force: true });
  console.log(`Mirrored Redis bundle into ${DESKTOP_OUT}`);
}

async function main() {
  const key = resolveTargetKey();
  if (!key) {
    throw new Error(`Unsupported Redis target: ${process.env.TARGET_PLATFORM || hostPlatform()}/${process.env.TARGET_ARCH || hostArch()}`);
  }

  const binName = binaryName(key);
  const markerPath = join(RUNTIME_OUT, '.redis-target');
  const markerMatches = existsSync(markerPath) && readFileSync(markerPath, 'utf8').trim() === key;
  const existing = join(RUNTIME_OUT, 'bin', binName);

  if (
    existsSync(existing)
    && markerMatches
    && process.env.AGENTX_FORCE_REDIS !== '1'
  ) {
    try {
      verifyRedis(existing, key);
      console.log(`Redis already set up at ${RUNTIME_OUT} (${key})`);
      mirrorToDesktop();
      return;
    } catch {
      console.warn('Existing Redis bundle failed verification; rebuilding…');
    }
  }

  rmSync(RUNTIME_OUT, { recursive: true, force: true });
  mkdirSync(RUNTIME_OUT, { recursive: true });

  if (key === 'win32-x64') {
    await buildRedisWindows();
  } else {
    await buildRedisSource(key);
  }

  writeFileSync(join(RUNTIME_OUT, '.redis-target'), `${key}\n`);
  mirrorToDesktop();
  console.log(`Redis setup complete: ${join(RUNTIME_OUT, 'bin', binName)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
