/**
 * Build Apache AGE from source against the embedded PostgreSQL binaries and
 * install the extension into the bundled native tree.
 *
 * Run after `pnpm install` (or in CI) so the embedded PostgreSQL ships with
 * a working AGE extension. This script compiles for the host platform and
 * produces universal binaries on macOS.
 *
 * Prerequisites: The PostgreSQL source must already be built in .pgvector-build/pg-install
 * (run setup-pgvector.mjs first, which downloads and builds PG source).
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { platform, arch, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGE_BRANCH = process.env.AGE_BRANCH || 'PG17/v1.7.0-rc0';

function getPackageName() {
  const currentPlatform = platform();
  const currentArch = arch();
  switch (currentPlatform) {
    case 'darwin':
      return currentArch === 'arm64' || currentArch === 'x64' ? '@embedded-postgres/darwin-arm64' : null;
    case 'linux':
      return currentArch === 'arm64' ? '@embedded-postgres/linux-arm64' : currentArch === 'x64' ? '@embedded-postgres/linux-x64' : null;
    case 'win32':
      return currentArch === 'x64' ? '@embedded-postgres/windows-x64' : null;
    default:
      return null;
  }
}

function getPostgresBinaryName() {
  return platform() === 'win32' ? 'postgres.exe' : 'postgres';
}

function resolvePlatformPackage(packageName) {
  try {
    const modPath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`));
    return dirname(modPath);
  } catch {
    const workspaceRoot = resolve(__dirname, '..', '..', '..');
    const candidates = [
      join(workspaceRoot, 'node_modules', packageName),
      join(workspaceRoot, 'packages', 'desktop', 'node_modules', packageName),
      join(process.cwd(), 'node_modules', packageName),
    ];
    for (const candidate of candidates) {
      if (existsSync(join(candidate, 'package.json'))) return candidate;
    }
  }
  return null;
}

function exec(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function findVcvarsall() {
  const programFiles = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files'];
  const years = ['2022', '2019', '2017', '2015'];
  const editions = ['Community', 'Professional', 'Enterprise', 'BuildTools'];
  for (const pf of programFiles) {
    if (!pf) continue;
    for (const year of years) {
      for (const edition of editions) {
        const candidate = join(pf, 'Microsoft Visual Studio', year, edition, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function withVcvarsEnv(vcvarsallPath, archArg = 'x64') {
  const result = spawnSync('cmd.exe', ['/c', `${vcvarsallPath} ${archArg} && set`], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`vcvarsall.bat failed: ${result.stderr}`);
  }
  const env = { ...process.env };
  for (const line of result.stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      env[line.slice(0, idx)] = line.slice(idx + 1).trim();
    }
  }
  return env;
}

function buildAgeUnix(ageDir, pgInstallDir, extraEnv = {}) {
  const pgConfig = join(pgInstallDir, 'bin', 'pg_config');
  try { exec(`make clean PG_CONFIG=${pgConfig}`, { cwd: ageDir, env: { ...process.env, ...extraEnv } }); } catch { /* ignore */ }
  exec(
    `make -j${process.env.CI ? '4' : String(cpus().length)} PG_CONFIG=${pgConfig}`,
    { cwd: ageDir, env: { ...process.env, ...extraEnv } },
  );
  exec(
    `make PG_CONFIG=${pgConfig} install DESTDIR=${join(dirname(ageDir), 'age-install')}`,
    { cwd: ageDir, env: { ...process.env, ...extraEnv } },
  );
}

function buildAgeMacUniversal(ageDir, pgInstallDir, nativeDir) {
  const pgConfig = join(pgInstallDir, 'bin', 'pg_config');
  const pgBinDir = join(pgInstallDir, 'bin');
  const embeddedPostgres = join(nativeDir, 'bin', 'postgres');

  if (!existsSync(embeddedPostgres)) {
    throw new Error(`Could not find embedded universal postgres binary at ${embeddedPostgres}`);
  }

  // Replace the host-arch-only postgres binary with the universal embedded one so the
  // bundle_loader used by PGXS can satisfy both arm64 and x86_64 symbols.
  cpSync(embeddedPostgres, join(pgBinDir, 'postgres'), { force: true, preserveTimestamps: true });

  const universalCflags = [
    '-O3', '-Wall', '-Wmissing-prototypes', '-Wpointer-arith',
    '-Wdeclaration-after-statement', '-Werror=vla', '-Wendif-labels',
    '-Wmissing-format-attribute', '-Wimplicit-fallthrough=3', '-Wcast-function-type',
    '-Wformat-security', '-fno-strict-aliasing', '-fwrapv',
    '-arch arm64', '-arch x86_64',
  ].join(' ');

  const env = {
    ...process.env,
    CFLAGS: universalCflags,
    LDFLAGS: '-arch arm64 -arch x86_64',
    PG_CFLAGS: universalCflags,
  };

  try { exec(`make clean PG_CONFIG=${pgConfig}`, { cwd: ageDir, env }); } catch { /* ignore */ }
  exec(`make PG_CONFIG=${pgConfig}`, { cwd: ageDir, env });
  exec(`make PG_CONFIG=${pgConfig} install DESTDIR=${join(dirname(ageDir), 'age-install')}`, { cwd: ageDir, env });
}

function buildAgeWindows(ageDir, pgInstallDir) {
  const vcvarsall = findVcvarsall();
  if (!vcvarsall) {
    throw new Error('Could not find vcvarsall.bat. Install Visual Studio Build Tools for C++.');
  }
  const env = withVcvarsEnv(vcvarsall, 'x64');
  env.PGROOT = pgInstallDir;
  rmSync(join(dirname(ageDir), 'age-install'), { recursive: true, force: true });
  // AGE uses PGXS on Windows too
  const pgConfig = join(pgInstallDir, 'bin', 'pg_config');
  exec(`nmake /f Makefile clean PG_CONFIG=${pgConfig}`, { cwd: ageDir, env });
  exec(`nmake /f Makefile PG_CONFIG=${pgConfig}`, { cwd: ageDir, env });
  exec(`nmake /f Makefile install PG_CONFIG=${pgConfig} DESTDIR=${join(dirname(ageDir), 'age-install')}`, { cwd: ageDir, env });
}

function main() {
  const packageName = getPackageName();
  if (!packageName) {
    throw new Error(`Unsupported platform/architecture: ${platform()}/${arch()}`);
  }

  if (platform() === 'win32') {
    console.warn('Building Apache AGE from source is not supported on Windows. Skipping.');
    return;
  }

  const packageDir = resolvePlatformPackage(packageName);
  if (!packageDir) {
    throw new Error(`Could not resolve ${packageName}. Run pnpm install first.`);
  }

  const nativeDir = join(packageDir, 'native');
  const postgresBinaryName = getPostgresBinaryName();
  if (!existsSync(join(nativeDir, 'bin', postgresBinaryName))) {
    throw new Error(`Embedded PostgreSQL binaries not found in ${nativeDir}`);
  }

  const workDir = join(process.cwd(), '.pgvector-build');
  const pgInstallDir = join(workDir, 'pg-install');

  const pgConfigBinaryName = platform() === 'win32' ? 'pg_config.exe' : 'pg_config';
  if (!existsSync(join(pgInstallDir, 'bin', pgConfigBinaryName))) {
    throw new Error(
      `PostgreSQL source not built at ${pgInstallDir}. Run setup-pgvector.mjs first to download and build PostgreSQL headers.`,
    );
  }

  // Clone or update AGE source
  const ageDir = join(workDir, 'age');
  if (!existsSync(ageDir)) {
    console.log(`Cloning Apache AGE (${AGE_BRANCH})...`);
    exec(`git clone --depth 1 --branch ${AGE_BRANCH} https://github.com/apache/age.git ${ageDir}`, { cwd: workDir });
  } else {
    console.log('AGE source already cloned, pulling latest...');
    try { exec(`git fetch origin ${AGE_BRANCH} && git checkout ${AGE_BRANCH} && git pull`, { cwd: ageDir }); } catch { /* offline ok */ }
  }

  // Build AGE
  rmSync(join(workDir, 'age-install'), { recursive: true, force: true });

  if (platform() === 'darwin') {
    buildAgeMacUniversal(ageDir, pgInstallDir, nativeDir);
  } else if (platform() === 'win32') {
    buildAgeWindows(ageDir, pgInstallDir);
  } else {
    buildAgeUnix(ageDir, pgInstallDir);
  }

  // Copy installed files into the embedded postgres native tree
  const ageInstallDir = join(workDir, 'age-install');
  const extDir = join(nativeDir, 'share', 'postgresql', 'extension');
  const libDir = join(nativeDir, 'lib', 'postgresql');

  // DESTDIR install puts files under age-install/<pgInstallDir>/...
  const srcExtDir = join(ageInstallDir, pgInstallDir, 'share', 'postgresql', 'extension');
  if (existsSync(srcExtDir)) {
    for (const f of readdirSync(srcExtDir)) {
      if (f.startsWith('age')) {
        cpSync(join(srcExtDir, f), join(extDir, f), { force: true });
        console.log(`Installed extension file: ${f}`);
      }
    }
  }

  // Copy the shared library
  const srcLibDir = join(ageInstallDir, pgInstallDir, 'lib', 'postgresql');
  if (existsSync(srcLibDir)) {
    for (const f of readdirSync(srcLibDir)) {
      if (f.startsWith('age') && (f.endsWith('.dylib') || f.endsWith('.so') || f.endsWith('.dll'))) {
        cpSync(join(srcLibDir, f), join(libDir, f), { force: true });
        console.log(`Installed library: ${f}`);
      }
    }
  }

  // Verify
  const ageControl = join(extDir, 'age.control');
  if (existsSync(ageControl)) {
    console.log('\n✅ Apache AGE installed successfully!');
    console.log(`   Control file: ${ageControl}`);
    const ageLib = readdirSync(libDir).find(f => f.startsWith('age') && (f.endsWith('.dylib') || f.endsWith('.so') || f.endsWith('.dll')));
    if (ageLib) console.log(`   Library: ${join(libDir, ageLib)}`);
  } else {
    throw new Error('AGE installation verification failed — age.control not found');
  }
}

main();
