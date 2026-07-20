import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { platform } from 'node:os';
import { getLogger } from '@agentx/shared';
import { RedisBinaryResolver } from './RedisBinaryResolver.js';

export { RedisBinaryResolver } from './RedisBinaryResolver.js';

export interface RedisLifecycleOptions {
  dataDir: string;
  port?: number;
  host?: string;
  binaryPath?: string;
  onLog?: (message: string) => void;
  onWarn?: (message: string) => void;
  onError?: (message: string) => void;
}

/**
 * Starts an embedded `redis-server` process when the bundled app boots.
 *
 * - If `REDIS_URL` is already set, it is reused and no local server is started.
 * - If `AGENTX_EMBEDDED_REDIS_ENABLED` is `0`, embedded Redis is skipped.
 * - If no `redis-server` binary can be found, the runtime falls back to the
 *   in-memory `LocalCache` (Redis is treated as optional).
 */
export class RedisLifecycleManager {
  private options: Required<RedisLifecycleOptions>;
  private process?: ChildProcess;
  private shuttingDown = false;

  constructor(options: RedisLifecycleOptions) {
    this.options = {
      dataDir: options.dataDir,
      port: options.port ?? 6379,
      host: options.host ?? '127.0.0.1',
      binaryPath: options.binaryPath ?? '',
      onLog: options.onLog ?? ((msg) => getLogger().info('REDIS', msg)),
      onWarn: options.onWarn ?? ((msg) => getLogger().warn('REDIS', msg)),
      onError: options.onError ?? ((msg) => getLogger().error('REDIS', msg)),
    };
  }

  /**
   * Start the embedded Redis server.
   * Returns the `REDIS_URL` connection string, or `null` if Redis is skipped.
   */
  async start(): Promise<string | null> {
    const existingUrl = process.env['REDIS_URL'];
    if (existingUrl) {
      this.options.onLog(`Using REDIS_URL from environment: ${redactUrl(existingUrl)}`);
      return existingUrl;
    }

    if (process.env['AGENTX_EMBEDDED_REDIS_ENABLED'] === '0') {
      this.options.onLog('Embedded Redis disabled by AGENTX_EMBEDDED_REDIS_ENABLED=0');
      return null;
    }

    if (this.process && !this.process.killed) {
      return this.buildConnectionString();
    }

    const binary = await new RedisBinaryResolver({
      binaryPath: this.options.binaryPath || undefined,
      installDir: process.env['AGENTX_INSTALL_DIR'] || undefined,
      resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || undefined,
    }).findBinary();

    if (!binary) {
      this.options.onWarn(
        'No redis-server binary found. Using in-memory LocalCache instead. '
        + 'Install redis-memory-server, falkordblite, or set REDIS_BINARY_PATH to enable Redis.',
      );
      return null;
    }

    mkdirSync(this.options.dataDir, { recursive: true });

    this.ensureExecutable(binary);

    const configPath = this.writeConfig();
    this.options.onLog(`Starting embedded Redis server on ${this.options.host}:${this.options.port}`);
    this.process = this.spawnRedis(binary);

    try {
      await this.waitForReady();
    } catch (e) {
      this.options.onError(`Redis server did not become ready: ${e instanceof Error ? e.message : e}`);
      this.stop().catch(() => {});
      unlinkSync(configPath);
      return null;
    }

    const connectionString = this.buildConnectionString();
    process.env['REDIS_URL'] = connectionString;
    process.env['AGENTX_EMBEDDED_REDIS_ENABLED'] = '1';
    this.options.onLog(`Redis ready: ${redactUrl(connectionString)}`);
    return connectionString;
  }

  async stop(): Promise<void> {
    if (!this.process || this.process.killed) return;

    this.shuttingDown = true;
    this.options.onLog('Stopping Redis server');

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

    if (process.env['AGENTX_EMBEDDED_REDIS_ENABLED'] === '1') {
      delete process.env['AGENTX_EMBEDDED_REDIS_ENABLED'];
    }
  }

  isRunning(): boolean {
    return !!this.process && !this.process.killed;
  }

  private buildConnectionString(): string {
    return `redis://${this.options.host}:${this.options.port}`;
  }

  private writeConfig(): string {
    const configPath = join(this.options.dataDir, 'redis.conf');
    const config = [
      'bind 127.0.0.1',
      `port ${this.options.port}`,
      'protected-mode no',
      'daemonize no',
      'dir .',
      'dbfilename dump.rdb',
      'save ""',
      'appendonly no',
      'loglevel notice',
      'logfile ""',
    ].join('\n');

    writeFileSync(configPath, config);
    return configPath;
  }

  private spawnRedis(binary: string): ChildProcess {
    const child = spawn(binary, ['redis.conf'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: this.options.dataDir,
      env: process.env,
      detached: false,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trimEnd();
      if (line) this.options.onLog(line);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trimEnd();
      if (line) this.options.onError(line);
    });

    child.on('error', (err) => {
      this.options.onError(`Redis process error: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      if (!this.shuttingDown) {
        this.options.onError(`Redis process exited unexpectedly (code: ${code}, signal: ${signal})`);
      }
    });

    return child;
  }

  private waitForReady(): Promise<void> {
    const maxAttempts = 120;
    const intervalMs = 500;

    return new Promise((resolve, reject) => {
      let attempt = 0;

      const tryConnect = () => {
        attempt++;
        const socket = createConnection({ port: this.options.port, host: this.options.host });

        let resolved = false;

        const cleanup = () => {
          try { socket.destroy(); } catch { /* ignore */ }
        };

        const onError = (err?: Error) => {
          if (resolved) return;
          cleanup();
          if (attempt >= maxAttempts) {
            reject(new Error(`Redis did not become ready after ${maxAttempts} attempts${err ? `: ${err.message}` : ''}`));
            return;
          }
          setTimeout(tryConnect, intervalMs);
        };

        socket.on('connect', () => {
          // Send PING and expect PONG to confirm Redis is accepting commands.
          socket.write('PING\r\n');
        });

        socket.on('data', (data: Buffer) => {
          if (resolved) return;
          if (data.toString().includes('PONG')) {
            resolved = true;
            cleanup();
            resolve();
          }
        });

        socket.on('error', onError);
        socket.on('close', () => {
          if (!resolved) onError();
        });
      };

      tryConnect();
    });
  }

  private ensureExecutable(filePath: string): void {
    if (platform() === 'win32') return;
    try {
      const stat = statSync(filePath);
      if ((stat.mode & 0o111) === 0) {
        chmodSync(filePath, stat.mode | 0o755);
      }
    } catch {
      // ignore
    }
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}
