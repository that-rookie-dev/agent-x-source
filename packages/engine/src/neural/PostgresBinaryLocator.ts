/**
 * Locate bundled PostgreSQL binaries (pg_dump, pg_restore, psql) for backup/restore.
 *
 * Tries the Electron app resources paths first, then falls back to Node module
 * resolution for development / standalone usage.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { platform, arch } from 'node:os';

export interface LocatedBinaries {
  binaryDir: string;
  pgDump: string;
  pgRestore: string;
  psql: string;
  postgres: string;
}

function getPackageName(): string {
  const currentPlatform = platform();
  const currentArch = arch();
  switch (currentPlatform) {
    case 'darwin':
      return currentArch === 'arm64' ? '@embedded-postgres/darwin-arm64' : currentArch === 'x64' ? '@embedded-postgres/darwin-x64' : '';
    case 'linux':
      return currentArch === 'arm64' ? '@embedded-postgres/linux-arm64' : currentArch === 'x64' ? '@embedded-postgres/linux-x64' : '';
    case 'win32':
      return currentArch === 'x64' ? '@embedded-postgres/windows-x64' : '';
    default:
      return '';
  }
}

function binaryExt(): string {
  return platform() === 'win32' ? '.exe' : '';
}

function requiredCoreBinaryNames(): string[] {
  const ext = binaryExt();
  return [`postgres${ext}`, `initdb${ext}`, `pg_ctl${ext}`];
}

function isCompleteCoreBinaryDir(dir: string): boolean {
  if (!dir) return false;
  return requiredCoreBinaryNames().every((name) => existsSync(join(dir, name)));
}

function fallbackPackageNames(primary: string): string[] {
  if (primary === '@embedded-postgres/darwin-x64') {
    return ['@embedded-postgres/darwin-arm64'];
  }
  return [];
}

function binaryDirCandidates(packageName: string): string[] {
  // process.resourcesPath is only defined in Electron-packaged builds.
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath ?? '';
  const installDir = process.env['AGENTX_INSTALL_DIR'] ?? '';
  const execDir = dirname(process.execPath);

  const candidates = [
    join(resourcesPath, 'app.asar.unpacked', 'node_modules', packageName, 'native', 'bin'),
    join(resourcesPath, 'app.asar.unpacked', 'node_modules', '.pnpm', packageName, 'native', 'bin'),
    join(resourcesPath, 'node_modules', packageName, 'native', 'bin'),
    join(installDir, 'node_modules', packageName, 'native', 'bin'),
    join(installDir, 'resources', 'node_modules', packageName, 'native', 'bin'),
    join(execDir, 'node_modules', packageName, 'native', 'bin'),
    join(process.cwd(), 'node_modules', packageName, 'native', 'bin'),
  ];

  for (const fallback of fallbackPackageNames(packageName)) {
    candidates.push(
      join(resourcesPath, 'app.asar.unpacked', 'node_modules', fallback, 'native', 'bin'),
      join(installDir, 'node_modules', fallback, 'native', 'bin'),
      join(installDir, 'resources', 'node_modules', fallback, 'native', 'bin'),
    );
  }

  return candidates;
}

export async function locatePostgresBinaries(): Promise<LocatedBinaries> {
  const packageName = getPackageName();
  if (!packageName) {
    throw new Error(`Unsupported platform/architecture: ${platform()}/${arch()}`);
  }

  const ext = binaryExt();

  for (const candidate of binaryDirCandidates(packageName)) {
    if (candidate && isCompleteCoreBinaryDir(candidate)) {
      return {
        binaryDir: candidate,
        pgDump: join(candidate, `pg_dump${ext}`),
        pgRestore: join(candidate, `pg_restore${ext}`),
        psql: join(candidate, `psql${ext}`),
        postgres: join(candidate, `postgres${ext}`),
      };
    }
  }

  const importPackages = [packageName, ...fallbackPackageNames(packageName)];
  for (const pkg of importPackages) {
    try {
      const mod = await import(pkg) as { postgres: string; initdb?: string; pg_ctl?: string };
      const importDirs = [
        dirname(mod.postgres),
        mod.initdb ? dirname(mod.initdb) : '',
        mod.pg_ctl ? dirname(mod.pg_ctl) : '',
      ].filter(Boolean);
      for (const binaryDir of importDirs) {
        if (!isCompleteCoreBinaryDir(binaryDir)) continue;
        return {
          binaryDir,
          pgDump: join(binaryDir, `pg_dump${ext}`),
          pgRestore: join(binaryDir, `pg_restore${ext}`),
          psql: join(binaryDir, `psql${ext}`),
          postgres: join(binaryDir, `postgres${ext}`),
        };
      }
    } catch { /* try next package */ }
  }

  throw new Error(
    `Could not resolve complete PostgreSQL binaries for ${packageName} on ${platform()}/${arch()}. `
    + 'Reinstall Agent-X to restore embedded PostgreSQL.',
  );
}
