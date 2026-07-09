import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'fs';
import { join, dirname, basename, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { platform, arch } from 'os';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'python');

const PBS_RELEASE = '20260610';
const PY_VER = '3.12.13';

const PBS_URLS = {
  'darwin-arm64': `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/cpython-${PY_VER}+${PBS_RELEASE}-aarch64-apple-darwin-install_only.tar.gz`,
  'darwin-x64':  `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/cpython-${PY_VER}+${PBS_RELEASE}-x86_64-apple-darwin-install_only.tar.gz`,
  'linux-x64':   `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/cpython-${PY_VER}+${PBS_RELEASE}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
  'linux-arm64': `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/cpython-${PY_VER}+${PBS_RELEASE}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
  'win32-x64':   `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/cpython-${PY_VER}+${PBS_RELEASE}-x86_64-pc-windows-msvc-install_only.tar.gz`,
};

const key = `${platform()}-${arch()}`;
const url = PBS_URLS[key];
if (!url) {
  console.error(`No PBS build for ${key}`);
  process.exit(1);
}

const IS_WIN = platform() === 'win32';

const pythonBin = IS_WIN
  ? join(OUT_DIR, 'python.exe')
  : join(OUT_DIR, 'bin', 'python3');

/** Rewrite absolute bin/ symlinks to relative targets so packs survive CI → user machines. */
function normalizeBinSymlinks(binDir) {
  if (!existsSync(binDir)) return;
  for (const name of readdirSync(binDir)) {
    const linkPath = join(binDir, name);
    let st;
    try {
      st = lstatSync(linkPath);
    } catch {
      continue;
    }
    if (!st.isSymbolicLink()) continue;
    let target;
    try {
      target = readlinkSync(linkPath);
    } catch {
      continue;
    }
    if (!isAbsolute(target)) continue;
    const resolved = existsSync(target) ? target : join(binDir, basename(target));
    if (!existsSync(resolved)) continue;
    const rel = relative(binDir, resolved) || basename(resolved);
    unlinkSync(linkPath);
    symlinkSync(rel, linkPath);
  }
}

if (existsSync(pythonBin)) {
  if (!IS_WIN) {
    normalizeBinSymlinks(join(OUT_DIR, 'bin'));
  }
  console.log(`Python ${PY_VER} already set up at ${OUT_DIR}`);
  process.exit(0);
}

console.log(`Downloading Python ${PY_VER} for ${key}...`);
console.log(`  ${url}`);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const TARBALL = join(OUT_DIR, 'python.tar.gz');

const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

const file = createWriteStream(TARBALL);
await pipeline(res.body, file);

console.log('Extracting...');
execSync(`tar -xzf "${TARBALL}" -C "${OUT_DIR}" --strip-components=1`, { stdio: 'pipe' });

// Windows PBS archives sometimes have a nested 'python/' directory inside the tarball
if (IS_WIN) {
  const inner = join(OUT_DIR, 'python');
  if (existsSync(inner)) {
    for (const entry of readdirSync(inner)) {
      renameSync(join(inner, entry), join(OUT_DIR, entry));
    }
    rmSync(inner, { recursive: true, force: true });
  }
}

rmSync(TARBALL);

if (!IS_WIN) {
  normalizeBinSymlinks(join(OUT_DIR, 'bin'));
}

// Bootstrap pip (PBS ships ensurepip but not pre-installed pip)
console.log('Bootstrapping pip...');
execSync(`"${pythonBin}" -m ensurepip --upgrade`, { stdio: 'pipe' });
execSync(`"${pythonBin}" -m pip install --upgrade pip --quiet`, { stdio: 'pipe' });

// Pre-install commonly needed packages for agent tasks
console.log('Installing packages...');
execSync(`"${pythonBin}" -m pip install --quiet pillow requests`, { stdio: 'inherit' });

if (!IS_WIN) {
  normalizeBinSymlinks(join(OUT_DIR, 'bin'));
}

console.log('Python setup complete.');
