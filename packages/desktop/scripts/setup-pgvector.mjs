/**
 * Build pgvector from source against the embedded PostgreSQL binaries and install
 * the extension into the bundled native tree.
 *
 * Run after `pnpm install` (or in CI) so the embedded PostgreSQL ships with a working
 * vector extension. This script compiles for the host platform and produces
 * universal binaries on macOS.
 *
 * Zero npm dependencies are added; all compilation is done from source.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { platform, arch, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PGVECTOR_VERSION = process.env.PGVECTOR_VERSION || 'v0.8.3';

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

function getPgConfigBinaryName() {
  return platform() === 'win32' ? 'pg_config.exe' : 'pg_config';
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

function readEmbeddedPostgresVersion(packageDir) {
  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const match = packageJson.version?.match(/^(\d+\.\d+)/);
  return match ? match[1] : null;
}

function exec(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function execOut(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

function downloadWindowsPostgresBinaries(pgVersion, pgInstallDir) {
  const zipDir = dirname(pgInstallDir);
  let lastError;
  for (let build = 1; build <= 5; build++) {
    const zipUrl = `https://get.enterprisedb.com/postgresql/postgresql-${pgVersion}-${build}-windows-x64-binaries.zip`;
    const zipPath = join(zipDir, `postgresql-${pgVersion}-${build}-windows-x64-binaries.zip`);
    rmSync(zipPath, { force: true });
    console.log(`Downloading PostgreSQL ${pgVersion} Windows binaries from ${zipUrl}...`);
    try {
      exec(`curl -f -L -o "${zipPath}" "${zipUrl}"`, { cwd: zipDir });
      if (!existsSync(zipPath)) {
        throw new Error(`Download succeeded but ${zipPath} was not created`);
      }
      console.log(`Extracting PostgreSQL ${pgVersion} Windows binaries...`);
      rmSync(pgInstallDir, { recursive: true, force: true });
      mkdirSync(pgInstallDir, { recursive: true });
      exec(`tar -xf "${zipPath}" -C "${pgInstallDir}" --strip-components=1`, { cwd: zipDir });
      return;
    } catch (e) {
      lastError = e;
      console.warn(`Failed to download ${zipUrl}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(
    `Could not download PostgreSQL ${pgVersion} Windows binaries after trying build numbers 1-5: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
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
  const cmd = `"${vcvarsallPath}" ${archArg} && set`;
  const result = spawnSync(cmd, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
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

function buildPgVectorUnix(pgvectorDir, pgInstallDir, extraEnv = {}) {
  const pgConfig = join(pgInstallDir, 'bin', 'pg_config');
  try { exec(`make clean PG_CONFIG=${pgConfig}`, { cwd: pgvectorDir, env: { ...process.env, ...extraEnv } }); } catch { /* ignore */ }
  exec(
    `make -j${process.env.CI ? '4' : String(cpus().length)} PG_CONFIG=${pgConfig}`,
    { cwd: pgvectorDir, env: { ...process.env, ...extraEnv } },
  );
  exec(
    `make PG_CONFIG=${pgConfig} install DESTDIR=${join(dirname(pgvectorDir), 'pgvector-install')}`,
    { cwd: pgvectorDir, env: { ...process.env, ...extraEnv } },
  );
}

function buildPgVectorMacUniversal(pgvectorDir, pgInstallDir, nativeDir) {
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

  try { exec(`make clean PG_CONFIG=${pgConfig}`, { cwd: pgvectorDir, env }); } catch { /* ignore */ }
  exec(`make PG_CONFIG=${pgConfig}`, { cwd: pgvectorDir, env });
  exec(`make PG_CONFIG=${pgConfig} install DESTDIR=${join(dirname(pgvectorDir), 'pgvector-install')}`, { cwd: pgvectorDir, env });
}

function buildPgVectorWindows(pgvectorDir, pgInstallDir) {
  const vcvarsall = findVcvarsall();
  if (!vcvarsall) {
    throw new Error('Could not find vcvarsall.bat. Install Visual Studio Build Tools for C++.');
  }
  const env = withVcvarsEnv(vcvarsall, 'x64');
  env.PGROOT = pgInstallDir;
  exec('nmake /F Makefile.win clean', { cwd: pgvectorDir, env });
  exec('nmake /F Makefile.win', { cwd: pgvectorDir, env });
  exec('nmake /F Makefile.win install', { cwd: pgvectorDir, env });
}

function main() {
  const packageName = getPackageName();
  if (!packageName) {
    throw new Error(`Unsupported platform/architecture: ${platform()}/${arch()}`);
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

  const pgVersion = readEmbeddedPostgresVersion(packageDir);
  if (!pgVersion) {
    throw new Error(`Could not determine embedded PostgreSQL version from ${packageDir}/package.json`);
  }

  const workDir = join(process.cwd(), '.pgvector-build');
  mkdirSync(workDir, { recursive: true });

  const pgInstallDir = join(workDir, 'pg-install');
  const pgConfigBinaryName = getPgConfigBinaryName();

  if (platform() === 'win32') {
    // On Windows, download the official EDB binary distribution which already ships with
    // headers, import libraries, and pg_config.exe. This is the same MSVC-built PostgreSQL
    // that the embedded package uses, so the resulting extension is ABI-compatible.
    if (!existsSync(join(pgInstallDir, 'bin', pgConfigBinaryName))) {
      downloadWindowsPostgresBinaries(pgVersion, pgInstallDir);
    }
  } else {
    const pgSourceUrl = `https://ftp.postgresql.org/pub/source/v${pgVersion}/postgresql-${pgVersion}.tar.gz`;
    const pgSourceDir = join(workDir, `postgresql-${pgVersion}`);
    if (!existsSync(pgSourceDir)) {
      const tarPath = join(workDir, `postgresql-${pgVersion}.tar.gz`);
      if (!existsSync(tarPath)) {
        console.log(`Downloading PostgreSQL ${pgVersion} source...`);
        exec(`curl -L -o ${tarPath} ${pgSourceUrl}`, { cwd: workDir });
      }
      console.log(`Extracting PostgreSQL ${pgVersion} source...`);
      exec(`tar xzf ${tarPath}`, { cwd: workDir });
    }

    if (!existsSync(join(pgInstallDir, 'bin', pgConfigBinaryName))) {
      console.log('Configuring PostgreSQL source...');
      const configureArgs = [
        `--prefix=${pgInstallDir}`,
        '--without-readline',
        '--without-zlib',
        '--without-ldap',
        '--with-openssl=no',
        '--without-libxml',
        '--without-libxslt',
        '--without-icu',
      ].join(' ');
      exec(`./configure ${configureArgs}`, { cwd: pgSourceDir });
      console.log('Building pg_config and headers...');
      exec(`make -j${process.env.CI ? '4' : String(cpus().length)} install`, { cwd: pgSourceDir });
    }
  }

  const pgvectorDir = join(workDir, 'pgvector');
  if (!existsSync(pgvectorDir)) {
    console.log(`Cloning pgvector ${PGVECTOR_VERSION}...`);
    exec(`git clone --branch ${PGVECTOR_VERSION} --depth 1 https://github.com/pgvector/pgvector.git ${pgvectorDir}`, { cwd: workDir });
  }

  console.log('Building pgvector...');
  if (platform() === 'darwin') {
    buildPgVectorMacUniversal(pgvectorDir, pgInstallDir, nativeDir);
  } else if (platform() === 'win32') {
    buildPgVectorWindows(pgvectorDir, pgInstallDir);
  } else {
    buildPgVectorUnix(pgvectorDir, pgInstallDir);
  }

  let srcLibDir, srcShareDir, destLibDir, destShareDir;
  if (platform() === 'win32') {
    // The EDB binary zip and pgvector's Makefile.win install directly into PGROOT\lib
    // and PGROOT\share\extension. The embedded package lays out extensions the same way.
    srcLibDir = join(pgInstallDir, 'lib');
    srcShareDir = join(pgInstallDir, 'share', 'extension');
    destLibDir = join(nativeDir, 'lib');
    destShareDir = join(nativeDir, 'share', 'extension');
  } else {
    const installedPrefix = join(workDir, 'pgvector-install', pgInstallDir);
    srcLibDir = join(installedPrefix, 'lib', 'postgresql');
    srcShareDir = join(installedPrefix, 'share', 'postgresql', 'extension');
    destLibDir = join(nativeDir, 'lib', 'postgresql');
    destShareDir = join(nativeDir, 'share', 'postgresql', 'extension');
  }

  mkdirSync(destLibDir, { recursive: true });
  mkdirSync(destShareDir, { recursive: true });

  for (const file of readdirSync(srcLibDir)) {
    if (/^vector\.(so|dylib|dll)$/i.test(file)) {
      cpSync(join(srcLibDir, file), join(destLibDir, file));
      console.log(`Installed ${file}`);
    }
  }

  for (const file of readdirSync(srcShareDir)) {
    if (file.startsWith('vector')) {
      cpSync(join(srcShareDir, file), join(destShareDir, file));
      console.log(`Installed ${file}`);
    }
  }

  console.log(`pgvector installed into ${nativeDir}`);
}

main();
