import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, statSync, writeFileSync, unlinkSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, totalmem } from 'node:os';
import { platform, arch } from 'node:os';
import { Pool } from 'pg';
import { buildEmbeddedPostgresChildEnv, getLogger } from '@agentx/shared';

const logger = {
  info: (code: string, message: string) => getLogger().info(code, message),
  warn: (code: string, message: string | Error) => getLogger().warn(code, message instanceof Error ? message.message : String(message)),
  error: (code: string, message: string | Error) => getLogger().error(code, message instanceof Error ? message : String(message)),
};

export interface PostgresLifecycleOptions {
  dataDir: string;
  port?: number;
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  binaryDir?: string;
  onLog?: (message: string) => void;
  onWarn?: (message: string | Error) => void;
  onError?: (message: string | Error) => void;
}

export interface PostgresBinaries {
  initdb: string;
  postgres: string;
  pgCtl: string;
}

export class PostgresLifecycleManager {
  private options: Required<PostgresLifecycleOptions>;
  private process?: ChildProcess;
  private connectionString?: string;
  private shuttingDown = false;

  constructor(options: PostgresLifecycleOptions) {
    this.options = {
      dataDir: options.dataDir,
      port: options.port ?? 3335,
      host: options.host ?? '127.0.0.1',
      user: options.user ?? 'agentx',
      password: options.password ?? 'agentx',
      database: options.database ?? 'agentx',
      binaryDir: options.binaryDir ?? '',
      onLog: options.onLog ?? ((msg) => logger.info('PG_LIFECYCLE', msg)),
      onWarn: options.onWarn ?? ((msg) => logger.warn('PG_LIFECYCLE', msg)),
      onError: options.onError ?? ((msg) => logger.error('PG_LIFECYCLE', msg)),
    };
  }

  private getPackageName(): string {
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

  private binaryExt(): string {
    return platform() === 'win32' ? '.exe' : '';
  }

  private requiredBinaryNames(): string[] {
    const ext = this.binaryExt();
    return [`postgres${ext}`, `initdb${ext}`, `pg_ctl${ext}`];
  }

  private isCompleteBinaryDir(dir: string): boolean {
    if (!dir) return false;
    return this.requiredBinaryNames().every((name) => existsSync(join(dir, name)));
  }

  private fallbackPackageNames(primary: string): string[] {
    // macOS packages ship universal binaries — either arch tree can donate missing files.
    if (primary === '@embedded-postgres/darwin-x64') return ['@embedded-postgres/darwin-arm64'];
    if (primary === '@embedded-postgres/darwin-arm64') return ['@embedded-postgres/darwin-x64'];
    return [];
  }

  private packageBinaryCandidates(packageName: string, installDir: string, resourcesPath: string, execDir: string): string[] {
    const candidates = [
      join(resourcesPath, 'app.asar.unpacked', 'node_modules', packageName, 'native', 'bin'),
      join(resourcesPath, 'app.asar.unpacked', 'node_modules', '.pnpm', packageName, 'native', 'bin'),
      join(resourcesPath, 'node_modules', packageName, 'native', 'bin'),
      join(installDir, 'node_modules', packageName, 'native', 'bin'),
      join(installDir, 'resources', 'node_modules', packageName, 'native', 'bin'),
      join(execDir, 'node_modules', packageName, 'native', 'bin'),
      join(process.cwd(), 'node_modules', packageName, 'native', 'bin'),
    ];
    for (const fallback of this.fallbackPackageNames(packageName)) {
      candidates.push(
        join(resourcesPath, 'app.asar.unpacked', 'node_modules', fallback, 'native', 'bin'),
        join(installDir, 'node_modules', fallback, 'native', 'bin'),
        join(installDir, 'resources', 'node_modules', fallback, 'native', 'bin'),
        join(process.cwd(), 'node_modules', fallback, 'native', 'bin'),
      );
    }
    return candidates;
  }

  /**
   * initdb requires `postgres` in the *same* directory as itself.
   * Broken installs often have initdb/pg_ctl but missing postgres — repair in place
   * by copying from any complete donor tree (same host or sibling macOS arch).
   */
  private repairIncompleteBinaryDir(targetDir: string, donorDirs: string[]): boolean {
    if (!targetDir || !existsSync(targetDir)) return false;
    if (this.isCompleteBinaryDir(targetDir)) return true;

    const missing = this.requiredBinaryNames().filter((name) => !existsSync(join(targetDir, name)));
    if (missing.length === 0) return true;

    let repaired = 0;
    for (const name of missing) {
      const dest = join(targetDir, name);
      for (const donor of donorDirs) {
        if (!donor || donor === targetDir || !existsSync(join(donor, name))) continue;
        try {
          cpSync(join(donor, name), dest, { force: true });
          this.ensureExecutable(dest);
          repaired += 1;
          this.options.onWarn(`Repaired missing PostgreSQL binary: ${name} ← ${donor}`);
          break;
        } catch (e) {
          this.options.onWarn(`Failed to repair ${name} from ${donor}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    return this.isCompleteBinaryDir(targetDir) && repaired >= 0;
  }

  private collectDonorBinaryDirs(packageName: string, installDir: string, resourcesPath: string, execDir: string): string[] {
    const pkgs = [packageName, ...this.fallbackPackageNames(packageName)];
    const dirs: string[] = [];
    for (const pkg of pkgs) {
      dirs.push(...this.packageBinaryCandidates(pkg, installDir, resourcesPath, execDir));
    }
    // Also scan sibling @embedded-postgres/*/native/bin under installDir
    const scope = join(installDir, 'node_modules', '@embedded-postgres');
    if (existsSync(scope)) {
      try {
        for (const entry of readdirSync(scope)) {
          dirs.push(join(scope, entry, 'native', 'bin'));
        }
      } catch { /* ignore */ }
    }
    return [...new Set(dirs.filter(Boolean))];
  }

  private async getBinaryDir(): Promise<string> {
    if (this.options.binaryDir && this.isCompleteBinaryDir(this.options.binaryDir)) {
      return this.options.binaryDir;
    }

    const packageName = this.getPackageName();
    if (!packageName) {
      throw new Error(`Unsupported platform/architecture: ${platform()}/${arch()}`);
    }

    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '';
    const installDir = process.env['AGENTX_INSTALL_DIR'] ?? '';
    const execDir = dirname(process.execPath);
    const primaryCandidates = this.packageBinaryCandidates(packageName, installDir, resourcesPath, execDir);
    const donors = this.collectDonorBinaryDirs(packageName, installDir, resourcesPath, execDir);
    const completeDonors = donors.filter((d) => this.isCompleteBinaryDir(d));

    // Prefer a complete primary tree; if incomplete, repair in place (initdb needs same-dir postgres).
    for (const candidate of primaryCandidates) {
      if (!candidate || !existsSync(candidate)) continue;
      if (this.isCompleteBinaryDir(candidate)) return candidate;
      if (this.repairIncompleteBinaryDir(candidate, completeDonors.length ? completeDonors : donors)) {
        this.options.onLog(`Repaired incomplete PostgreSQL binaries in ${candidate}`);
        return candidate;
      }
    }

    // Fall back to any complete donor directory (e.g. sibling macOS arch with universal bins).
    for (const donor of completeDonors) {
      if (donor.includes('darwin-arm64') && packageName.includes('darwin-x64')) {
        this.options.onWarn(
          'darwin-x64 PostgreSQL binaries were incomplete — using darwin-arm64 universal binaries instead',
        );
      }
      return donor;
    }

    const importPackages = [packageName, ...this.fallbackPackageNames(packageName)];
    const importErrors: string[] = [];
    for (const pkg of importPackages) {
      try {
        const mod = await import(pkg) as { initdb: string; postgres: string; pg_ctl: string };
        const importDirs = [dirname(mod.postgres), dirname(mod.initdb), dirname(mod.pg_ctl)];
        for (const dir of importDirs) {
          if (this.repairIncompleteBinaryDir(dir, completeDonors.length ? completeDonors : donors)) {
            return dir;
          }
          if (this.isCompleteBinaryDir(dir)) return dir;
        }
        const missing = this.requiredBinaryNames().filter(
          (name) => !importDirs.some((dir) => existsSync(join(dir, name))),
        );
        importErrors.push(`${pkg}: missing ${missing.join(', ')}`);
      } catch (e) {
        importErrors.push(`${pkg}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    throw new Error(
      `Incomplete native PostgreSQL binaries for ${packageName} on ${platform()}/${arch()}`
      + (importErrors.length ? ` (${importErrors.join('; ')})` : '')
      + '. Reinstall Agent-X or run the installer again to restore embedded PostgreSQL.',
    );
  }

  private async getBinaries(): Promise<PostgresBinaries> {
    const binaryDir = await this.getBinaryDir();
    const ext = this.binaryExt();
    const bin: PostgresBinaries = {
      initdb: join(binaryDir, `initdb${ext}`),
      postgres: join(binaryDir, `postgres${ext}`),
      pgCtl: join(binaryDir, `pg_ctl${ext}`),
    };
    for (const [label, filePath] of Object.entries(bin) as Array<[keyof PostgresBinaries, string]>) {
      if (!existsSync(filePath)) {
        throw new Error(
          `Missing PostgreSQL binary "${label}" at ${filePath}. `
          + 'The embedded PostgreSQL install is incomplete — reinstall Agent-X.',
        );
      }
      // npm/extract can drop +x; initdb requires an *executable* postgres beside itself.
      this.ensureExecutable(filePath);
    }
    return bin;
  }

  private ensureExecutable(filePath: string): void {
    if (platform() === 'win32') return;
    try {
      const stat = statSync(filePath);
      const executableMode = 0o111;
      if ((stat.mode & executableMode) === 0) {
        chmodSync(filePath, stat.mode | 0o755);
      }
    } catch (e) {
      this.options.onError(`Failed to ensure executable permissions for ${filePath}: ${e}`);
    }
  }

  private getProcessEnv(binaryDir: string): NodeJS.ProcessEnv {
    // Scoped to postgres/initdb children only — never set on the Agent-X process.
    // See buildEmbeddedPostgresChildEnv for darwin/linux/win32 behavior.
    return buildEmbeddedPostgresChildEnv({ binaryDir });
  }

  private runInitdb(bin: PostgresBinaries): void {
    if (existsSync(join(this.options.dataDir, 'PG_VERSION'))) {
      this.options.onLog('PostgreSQL data directory already initialized');
      return;
    }

    mkdirSync(this.options.dataDir, { recursive: true });
    // initdb locates postgres via same-dir + execute bit — chmod all three before init.
    this.ensureExecutable(bin.initdb);
    this.ensureExecutable(bin.postgres);
    this.ensureExecutable(bin.pgCtl);

    const passwordFile = join(tmpdir(), `agentx-pg-password-${Date.now().toString(36)}`);
    writeFileSync(passwordFile, `${this.options.password}\n`);

    this.options.onLog(`Initializing PostgreSQL data directory at ${this.options.dataDir}`);
    try {
      execFileSync(bin.initdb, [
        `--pgdata=${this.options.dataDir}`,
        `--username=${this.options.user}`,
        `--auth=password`,
        `--pwfile=${passwordFile}`,
        '--no-locale',
        '--encoding=UTF8',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
        env: this.getProcessEnv(dirname(bin.initdb)),
      });
    } catch (e) {
      const stderr = e instanceof Error && 'stderr' in e ? String((e as { stderr?: unknown }).stderr) : '';
      throw new Error(`initdb failed: ${e instanceof Error ? e.message : e}${stderr ? `\n${stderr}` : ''}`);
    } finally {
      try { unlinkSync(passwordFile); } catch { /* ignore */ }
    }
  }

  private spawnPostgres(bin: PostgresBinaries): ChildProcess {
    this.ensureExecutable(bin.postgres);
    this.options.onLog(`Starting PostgreSQL server on ${this.options.host}:${this.options.port}`);

    const ramGb = totalmem() / (1024 ** 3);
    const sharedBuffers = ramGb < 16 ? '64MB' : '128MB';
    const workMem = ramGb < 16 ? '8MB' : '12MB';
    const args = [
      '-D', this.options.dataDir,
      '-h', this.options.host,
      '-p', this.options.port.toString(),
      '-c', `shared_buffers=${sharedBuffers}`,
      '-c', 'max_connections=10',
      '-c', `work_mem=${workMem}`,
      '-c', 'maintenance_work_mem=32MB',
      '-c', 'max_wal_size=512MB',
      '-c', 'listen_addresses=127.0.0.1',
      '-c', 'unix_socket_directories=',
    ];

    const child = spawn(bin.postgres, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.getProcessEnv(binaryDir),
      detached: false,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.options.onLog(chunk.toString().trimEnd());
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.options.onError(chunk.toString().trimEnd());
    });

    child.on('error', (err) => {
      this.options.onError(`PostgreSQL process error: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      if (!this.shuttingDown) {
        this.options.onError(`PostgreSQL process exited unexpectedly (code: ${code}, signal: ${signal})`);
        if (platform() === 'win32') {
          this.options.onError(
            'On Windows, PostgreSQL refuses to start when the process runs as an Administrator. '
            + 'Start Agent-X from a standard (non-admin) user account.',
          );
        }
      }
    });

    return child;
  }

  private async waitForConnection(connectionString: string): Promise<void> {
    const pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 1000,
    });

    // Cold initdb + first start can take well over a few seconds on slower disks.
    const maxAttempts = 120;
    const intervalMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        await pool.end();
        return;
      } catch (e) {
        if (attempt === maxAttempts) {
          await pool.end().catch(() => {});
          throw new Error(`PostgreSQL did not become ready after ${maxAttempts} attempts: ${e instanceof Error ? e.message : e}`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }

  private async createDatabaseIfMissing(): Promise<void> {
    const maintenanceConnectionString = `postgresql://${this.options.user}:${encodeURIComponent(this.options.password)}@${this.options.host}:${this.options.port}/postgres`;
    await this.waitForConnection(maintenanceConnectionString);
    const pool = new Pool({ connectionString: maintenanceConnectionString, max: 1, connectionTimeoutMillis: 1000 });
    try {
      await pool.query(`CREATE DATABASE "${this.options.database}"`);
      this.options.onLog(`Created database ${this.options.database}`);
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      if (code === '42P04') {
        this.options.onLog(`Database ${this.options.database} already exists`);
      } else {
        throw new Error(`Failed to create database ${this.options.database}: ${e instanceof Error ? e.message : e}`);
      }
    } finally {
      await pool.end().catch(() => {});
    }
  }

  private async runSchemaSetup(): Promise<void> {
    if (!this.connectionString) throw new Error('No connection string available');
    await this.waitForConnection(this.connectionString);

    const pool = new Pool({ connectionString: this.connectionString, max: 1 });
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
      this.options.onLog('pgvector extension ready');
    } catch (e) {
      throw new Error(`pgvector extension failed: ${e instanceof Error ? e.message : e}. The bundled embedded PostgreSQL requires pgvector to be built and installed.`);
    }

    await pool.end();
  }

  async start(): Promise<string> {
    if (this.process && !this.process.killed) {
      return this.connectionString ?? this.buildConnectionString();
    }

    const bin = await this.getBinaries();
    this.runInitdb(bin);
    this.process = this.spawnPostgres(bin);
    this.connectionString = this.buildConnectionString();

    await this.createDatabaseIfMissing();
    await this.runSchemaSetup();

    this.options.onLog(`PostgreSQL ready: ${this.connectionString.replace(/:[^@]+@/, ':***@')}`);
    return this.connectionString;
  }

  async stop(): Promise<void> {
    if (!this.process || this.process.killed) return;

    this.shuttingDown = true;
    this.options.onLog('Stopping PostgreSQL server');

    this.process.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.process?.killed) {
          this.process?.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.process?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.process = undefined;
    this.shuttingDown = false;
  }

  isRunning(): boolean {
    return !!this.process && !this.process.killed;
  }

  private buildConnectionString(): string {
    const encodedPassword = encodeURIComponent(this.options.password);
    return `postgresql://${this.options.user}:${encodedPassword}@${this.options.host}:${this.options.port}/${this.options.database}`;
  }
}

export default PostgresLifecycleManager;
