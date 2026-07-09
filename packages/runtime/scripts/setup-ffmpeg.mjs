/**
 * Download a static ffmpeg binary for the target platform into packages/runtime/ffmpeg
 * (and mirror into packages/desktop/ffmpeg for electron-builder extraResources).
 *
 * Sources: eugeneware/ffmpeg-static release binaries (macOS / Linux / Windows).
 * Honours TARGET_PLATFORM / TARGET_ARCH for cross-arch desktop packs.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  chmodSync,
  copyFileSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { platform as hostPlatform, arch as hostArch } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_OUT = join(__dirname, '..', 'ffmpeg');
const DESKTOP_OUT = join(__dirname, '..', '..', 'desktop', 'ffmpeg');

const FFMPEG_RELEASE = process.env.FFMPEG_STATIC_RELEASE || 'b6.1.1';
const BASE_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}`;

const ASSETS = {
  'darwin-arm64': 'ffmpeg-darwin-arm64',
  'darwin-x64': 'ffmpeg-darwin-x64',
  'linux-x64': 'ffmpeg-linux-x64',
  'linux-arm64': 'ffmpeg-linux-arm64',
  'win32-x64': 'ffmpeg-win32-x64',
};

function normalizeArch(value) {
  return String(value || '').toLowerCase().includes('arm') ? 'arm64' : 'x64';
}

function normalizePlatform(value) {
  const p = String(value || '').toLowerCase();
  if (p === 'mac' || p === 'macos' || p === 'darwin') return 'darwin';
  if (p === 'win' || p === 'windows' || p === 'win32') return 'win32';
  if (p === 'linux') return 'linux';
  return p;
}

function resolveTargetKey() {
  const plat = normalizePlatform(process.env.TARGET_PLATFORM || process.env.npm_config_platform || hostPlatform());
  const cpu = normalizeArch(process.env.TARGET_ARCH || process.env.ARCH || process.env.npm_config_arch || hostArch());
  if (plat === 'darwin') return `darwin-${cpu}`;
  if (plat === 'linux') return `linux-${cpu}`;
  if (plat === 'win32') return 'win32-x64';
  return null;
}

function binaryName(key) {
  return key.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg';
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText} (${url})`);
  if (!res.body) throw new Error(`Empty response body for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

async function downloadGunzip(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText} (${url})`);
  if (!res.body) throw new Error(`Empty response body for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(destPath));
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

function canExecuteTarget(key) {
  const hostKey = `${normalizePlatform(hostPlatform())}-${normalizeArch(hostArch())}`;
  // win32-x64 key vs host win32-x64; darwin-x64 on darwin-arm64 cannot exec.
  return hostKey === key || (hostKey === 'win32-x64' && key === 'win32-x64');
}

function verifyFfmpeg(binPath, key) {
  if (!canExecuteTarget(key)) {
    console.log(`Skipping ffmpeg -version (cross-target ${key} on ${hostPlatform()}-${hostArch()})`);
    return;
  }
  const result = spawnSync(binPath, ['-version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `Bundled ffmpeg failed -version (status ${result.status}): ${result.stderr || result.stdout || 'no output'}`,
    );
  }
  const first = (result.stdout || '').split('\n')[0] || '';
  console.log(`Verified: ${first}`);
}

function installInto(outDir, binName, sourceBin) {
  const binDir = join(outDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const dest = join(binDir, binName);
  // sourceBin may live under outDir/.download — copy first, then scrub staging.
  copyFileSync(sourceBin, dest);
  if (!binName.endsWith('.exe')) {
    chmodSync(dest, 0o755);
  }
  clearMacQuarantine(dest);
  return dest;
}

async function main() {
  const key = resolveTargetKey();
  if (!key || !ASSETS[key]) {
    throw new Error(`Unsupported ffmpeg target: ${process.env.TARGET_PLATFORM || hostPlatform()}/${process.env.TARGET_ARCH || hostArch()}`);
  }

  const asset = ASSETS[key];
  const binName = binaryName(key);
  const markerPath = join(RUNTIME_OUT, '.ffmpeg-target');
  const existing = join(RUNTIME_OUT, 'bin', binName);
  const markerMatches = existsSync(markerPath) && readFileSync(markerPath, 'utf8').trim() === key;
  if (
    existsSync(existing)
    && markerMatches
    && process.env.AGENTX_FORCE_FFMPEG !== '1'
  ) {
    try {
      verifyFfmpeg(existing, key);
      console.log(`ffmpeg already set up at ${RUNTIME_OUT} (${key})`);
      // Keep desktop mirror in sync for electron-builder.
      if (existsSync(dirname(DESKTOP_OUT))) {
        cpSync(RUNTIME_OUT, DESKTOP_OUT, { recursive: true, force: true });
      }
      return;
    } catch {
      console.warn('Existing ffmpeg failed verification; re-downloading…');
    }
  }

  // Stage outside RUNTIME_OUT so install can wipe/replace the final tree safely.
  const workDir = join(__dirname, '..', '.ffmpeg-download');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const gzUrl = `${BASE_URL}/${asset}.gz`;
  const rawUrl = `${BASE_URL}/${asset}`;
  const staged = join(workDir, binName);

  console.log(`Downloading ffmpeg (${FFMPEG_RELEASE}) for ${key}…`);
  try {
    console.log(`  ${gzUrl}`);
    await downloadGunzip(gzUrl, staged);
  } catch (err) {
    console.warn(`gzip download failed (${err instanceof Error ? err.message : err}); trying uncompressed…`);
    console.log(`  ${rawUrl}`);
    await downloadToFile(rawUrl, staged);
  }

  if (!binName.endsWith('.exe')) {
    chmodSync(staged, 0o755);
  }

  rmSync(RUNTIME_OUT, { recursive: true, force: true });
  const runtimeBin = installInto(RUNTIME_OUT, binName, staged);
  writeFileSync(join(RUNTIME_OUT, '.ffmpeg-target'), `${key}\n`);
  verifyFfmpeg(runtimeBin, key);

  if (existsSync(dirname(DESKTOP_OUT))) {
    cpSync(RUNTIME_OUT, DESKTOP_OUT, { recursive: true, force: true });
    console.log(`Mirrored ffmpeg into ${DESKTOP_OUT}`);
  }

  rmSync(workDir, { recursive: true, force: true });
  console.log(`ffmpeg setup complete: ${runtimeBin}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
