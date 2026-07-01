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

export async function locatePostgresBinaries(): Promise<LocatedBinaries> {
  const packageName = getPackageName();
  if (!packageName) {
    throw new Error(`Unsupported platform/architecture: ${platform()}/${arch()}`);
  }

  const ext = platform() === 'win32' ? '.exe' : '';
  const resourcesPath = (process as any).resourcesPath ?? '';
  const candidates = [
    join(resourcesPath, 'app.asar.unpacked', 'node_modules', packageName, 'native', 'bin'),
    join(resourcesPath, 'app.asar.unpacked', 'node_modules', '.pnpm', packageName, 'native', 'bin'),
    join(resourcesPath, 'node_modules', packageName, 'native', 'bin'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, `postgres${ext}`))) {
      return {
        binaryDir: candidate,
        pgDump: join(candidate, `pg_dump${ext}`),
        pgRestore: join(candidate, `pg_restore${ext}`),
        psql: join(candidate, `psql${ext}`),
        postgres: join(candidate, `postgres${ext}`),
      };
    }
  }

  try {
    const mod = await import(packageName) as { postgres: string };
    const binaryDir = dirname(mod.postgres);
    return {
      binaryDir,
      pgDump: join(binaryDir, `pg_dump${ext}`),
      pgRestore: join(binaryDir, `pg_restore${ext}`),
      psql: join(binaryDir, `psql${ext}`),
      postgres: join(binaryDir, `postgres${ext}`),
    };
  } catch (e) {
    throw new Error(`Could not resolve PostgreSQL binaries for ${packageName}: ${e instanceof Error ? e.message : e}`);
  }
}
