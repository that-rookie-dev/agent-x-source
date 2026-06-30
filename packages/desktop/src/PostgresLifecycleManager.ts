import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { platform, arch } from 'node:os';
import { Pool } from 'pg';

const logger = {
  info: (code: string, message: string) => console.log(`[${code}] ${message}`),
  warn: (code: string, message: string | Error) => console.warn(`[${code}] ${message instanceof Error ? message.message : message}`),
  error: (code: string, message: string | Error) => console.error(`[${code}] ${message instanceof Error ? message.message : message}`),
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

  private async getBinaryDir(): Promise<string> {
    if (this.options.binaryDir) return this.options.binaryDir;

    const packageName = this.getPackageName();
    if (!packageName) {
      throw new Error(`Unsupported platform/architecture: ${platform()}/${arch()}`);
    }

    // 1. Try the bundled Electron app resources path (unpacked from asar).
    const resourcesPath = process.resourcesPath ?? '';
    const unpackedCandidates = [
      join(resourcesPath, 'app.asar.unpacked', 'node_modules', packageName, 'native', 'bin'),
      join(resourcesPath, 'app.asar.unpacked', 'node_modules', '.pnpm', packageName, 'native', 'bin'),
      join(resourcesPath, 'node_modules', packageName, 'native', 'bin'),
    ];
    const ext = platform() === 'win32' ? '.exe' : '';
    for (const candidate of unpackedCandidates) {
      if (existsSync(join(candidate, `postgres${ext}`))) {
        return candidate;
      }
    }

    // 2. Try resolving via Node module resolution (development / standalone).
    try {
      const mod = await import(packageName) as { initdb: string; postgres: string; pg_ctl: string };
      return dirname(mod.postgres);
    } catch (e) {
      throw new Error(`Could not resolve native PostgreSQL binaries for ${packageName}: ${e instanceof Error ? e.message : e}. Ensure embedded-postgres platform packages are installed or provide binaryDir.`);
    }
  }

  private async getBinaries(): Promise<PostgresBinaries> {
    const binaryDir = await this.getBinaryDir();
    const ext = platform() === 'win32' ? '.exe' : '';
    return {
      initdb: join(binaryDir, `initdb${ext}`),
      postgres: join(binaryDir, `postgres${ext}`),
      pgCtl: join(binaryDir, `pg_ctl${ext}`),
    };
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

  private runInitdb(bin: PostgresBinaries): void {
    if (existsSync(join(this.options.dataDir, 'PG_VERSION'))) {
      this.options.onLog('PostgreSQL data directory already initialized');
      return;
    }

    mkdirSync(this.options.dataDir, { recursive: true });
    this.ensureExecutable(bin.initdb);

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
      });
    } catch (e) {
      const stderr = e instanceof Error && 'stderr' in e ? String((e as any).stderr) : '';
      throw new Error(`initdb failed: ${e instanceof Error ? e.message : e}${stderr ? `\n${stderr}` : ''}`);
    } finally {
      try { unlinkSync(passwordFile); } catch { /* ignore */ }
    }
  }

  private spawnPostgres(bin: PostgresBinaries): ChildProcess {
    this.ensureExecutable(bin.postgres);
    this.options.onLog(`Starting PostgreSQL server on ${this.options.host}:${this.options.port}`);

    const args = [
      '-D', this.options.dataDir,
      '-h', this.options.host,
      '-p', this.options.port.toString(),
      '-c', 'shared_buffers=128MB',
      '-c', 'max_connections=10',
      '-c', 'work_mem=16MB',
      '-c', 'listen_addresses=127.0.0.1',
      '-c', 'unix_socket_directories=',
    ];

    // Apache AGE requires preloading. Only add it if the library is present in the
    // bundled native tree so a build without AGE still starts cleanly.
    const binaryDir = dirname(bin.postgres);
    const libDir = join(binaryDir, '..', 'lib', 'postgresql');
    const ext = platform() === 'win32' ? '.dll' : platform() === 'darwin' ? '.dylib' : '.so';
    if (existsSync(join(libDir, `age${ext}`))) {
      args.push('-c', 'shared_preload_libraries=age');
      this.options.onLog('Apache AGE preloading enabled');
    }

    const child = spawn(bin.postgres, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_MESSAGES: 'C' },
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

    const maxAttempts = 15;
    const intervalMs = 250;

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
    } catch (e: any) {
      if (e?.code === '42P04') {
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

    try {
      const { rows } = await pool.query(`SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'age') AS available`);
      if (rows[0]?.available) {
        this.options.onLog('AGE extension available');
      } else {
        this.options.onWarn?.('AGE extension not available; using relational CTE graph engine');
      }
    } catch (e) {
      this.options.onWarn?.(`AGE extension check skipped: ${e instanceof Error ? e.message : e}`);
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
