import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, renameSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { platform, arch } from 'os';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'python');
const DESKTOP_OUT = join(__dirname, '..', '..', 'desktop', 'python');

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

if (existsSync(pythonBin)) {
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
// Use a relative tarball path from OUT_DIR — Git Bash tar on Windows treats D:/... as a remote host.
execSync('tar -xzf python.tar.gz --strip-components=1', { cwd: OUT_DIR, stdio: 'pipe' });

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

// Bootstrap pip (PBS ships ensurepip but not pre-installed pip)
console.log('Bootstrapping pip...');
execSync(`"${pythonBin}" -m ensurepip --upgrade`, { stdio: 'pipe' });
execSync(`"${pythonBin}" -m pip install --upgrade pip --quiet`, { stdio: 'pipe' });

// Pre-install commonly needed packages for agent tasks
console.log('Installing packages...');
execSync(`"${pythonBin}" -m pip install --quiet pillow requests`, { stdio: 'inherit' });

// Mirror into packages/desktop/python for electron-builder extraResources.
if (existsSync(dirname(DESKTOP_OUT))) {
  cpSync(OUT_DIR, DESKTOP_OUT, { recursive: true, force: true });
  console.log(`Mirrored Python into ${DESKTOP_OUT}`);
}

console.log('Python setup complete.');
