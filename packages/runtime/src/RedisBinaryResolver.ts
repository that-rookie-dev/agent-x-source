import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { platform } from 'node:os';

export interface RedisBinaryResolverOptions {
  /** Explicit binary path, highest priority. */
  binaryPath?: string;
  /** Optional install directory (e.g. AGENTX_INSTALL_DIR) to search for node_modules. */
  installDir?: string;
  /** Electron resourcesPath. */
  resourcesPath?: string;
  /** Directory of process.execPath. */
  execDir?: string;
  /** Logger for warnings. */
  onWarn?: (message: string) => void;
}

/**
 * Locate a `redis-server` binary in the same way Postgres binaries are resolved:
 * explicit path, node_modules packages, app.asar unpacked, install/resources dirs,
 * and finally PATH.
 */
export class RedisBinaryResolver {
  private options: RedisBinaryResolverOptions;

  constructor(options: RedisBinaryResolverOptions = {}) {
    this.options = options;
  }

  async findBinary(): Promise<string | undefined> {
    const explicit = this.options.binaryPath ?? process.env['REDIS_BINARY_PATH'];
    if (explicit) {
      const resolved = resolve(explicit);
      if (this.isExecutable(resolved)) return resolved;
    }

    const candidates = this.buildCandidateDirs();
    for (const dir of candidates) {
      const found = this.findRedisServerInDir(dir);
      if (found) return resolve(found);
    }

    const fromPath = this.findInPath();
    return fromPath ? resolve(fromPath) : undefined;
  }

  private isExecutable(filePath: string): boolean {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) return false;
      if (platform() === 'win32') return true;
      return (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }

  private findRedisServerInDir(dir: string): string | undefined {
    if (!dir || !existsSync(dir)) return undefined;

    try {
      const result = this.searchForBinary(dir, 0, 5);
      if (result && this.isExecutable(result)) return result;
    } catch {
      // ignore
    }
    return undefined;
  }

  private searchForBinary(dir: string, depth: number, maxDepth: number): string | undefined {
    if (!existsSync(dir) || depth > maxDepth) return undefined;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const ext = platform() === 'win32' ? '.exe' : '';
      const targetName = `redis-server${ext}`;

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name === targetName) {
          return fullPath;
        }
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const found = this.searchForBinary(fullPath, depth + 1, maxDepth);
          if (found) return found;
        }
      }
    } catch {
      // ignore
    }

    return undefined;
  }

  private findInPath(): string | undefined {
    const pathEnv = process.env['PATH'];
    if (!pathEnv) return undefined;

    const ext = platform() === 'win32' ? '.exe' : '';
    const names = [`redis-server${ext}`, `redis-stack-server${ext}`];

    for (const dir of pathEnv.split(delimiter)) {
      for (const name of names) {
        const candidate = join(dir, name);
        if (existsSync(candidate)) return candidate;
      }
    }

    return undefined;
  }

  private buildCandidateDirs(): string[] {
    const installDir = this.options.installDir ?? process.env['AGENTX_INSTALL_DIR'] ?? '';
    const resourcesPath = this.options.resourcesPath ?? '';
    const execDir = this.options.execDir ?? (process.execPath ? dirname(process.execPath) : '');
    const cwd = process.cwd();

    const dirs: string[] = [];

    // 1. redis-memory-server compiled cache (default + our custom @embedded-redis target)
    const pushCacheDirs = (base: string) => {
      dirs.push(
        join(base, 'node_modules', '.cache', 'redis-memory-server', 'redis-binaries'),
        join(base, 'node_modules', '@embedded-redis', 'redis-binaries'),
        join(base, 'node_modules', 'redis-memory-server', '.cache'),
        join(base, 'node_modules', 'redis-memory-server', 'redis-binaries'),
      );
    };

    // 2. falkordblite prebuilt binaries
    const pushFalkorDirs = (base: string) => {
      dirs.push(
        join(base, 'node_modules', 'falkordblite'),
        join(base, 'node_modules', '@falkordblite'),
      );
    };

    // 3. redis-prebuilt / redis-stack packages
    const pushPackageDirs = (base: string) => {
      dirs.push(
        join(base, 'node_modules', 'redis-prebuilt'),
        join(base, 'node_modules', 'redis-stack-server'),
      );
    };

    const pushAllDirs = (base: string) => {
      pushCacheDirs(base);
      pushFalkorDirs(base);
      pushPackageDirs(base);
    };

    // Packaged Electron app paths.
    pushAllDirs(join(resourcesPath, 'app.asar.unpacked'));
    pushAllDirs(join(resourcesPath, 'app.asar.unpacked', 'node_modules'));
    pushAllDirs(join(resourcesPath, 'node_modules'));

    // Install / runtime dirs.
    pushAllDirs(installDir);
    pushAllDirs(join(installDir, 'resources'));
    pushAllDirs(execDir);

    // Dev monorepo paths.
    pushAllDirs(cwd);
    pushAllDirs(join(cwd, 'node_modules'));

    // Bundled redis-server trees built by setup-embedded-redis.mjs.
    dirs.push(join(resourcesPath, 'redis'));
    dirs.push(join(cwd, 'redis'));
    dirs.push(join(installDir, 'redis'));
    dirs.push(join(execDir, 'redis'));

    // pnpm virtual store (the package itself may contain a vendored bin).
    dirs.push(
      join(cwd, 'node_modules', '.pnpm', 'redis-memory-server', 'node_modules', 'redis-memory-server'),
    );

    return [...new Set(dirs.filter(Boolean))];
  }
}
