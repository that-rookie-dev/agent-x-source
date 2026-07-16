import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { VoiceSidecarClient } from './VoiceSidecarClient.js';

export type VoiceSidecarHealthState = 'not-installed' | 'stopped' | 'starting' | 'ready' | 'crashed';

export interface VoiceSidecarManagerOptions {
  dataDir: string;
  pythonExecutable?: string;
  moduleName?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface VoiceSidecarStatus {
  state: VoiceSidecarHealthState;
  baseUrl?: string;
  pid?: number;
  error?: string;
}

export class VoiceSidecarManager {
  private readonly options: VoiceSidecarManagerOptions;
  private child?: ChildProcess;
  private client?: VoiceSidecarClient;
  private status: VoiceSidecarStatus = { state: 'stopped' };
  private authToken = '';
  private stopping = false;

  constructor(options: VoiceSidecarManagerOptions) {
    this.options = options;
  }

  getStatus(): VoiceSidecarStatus {
    return { ...this.status };
  }

  getClient(): VoiceSidecarClient | undefined {
    return this.client;
  }

  async start(): Promise<VoiceSidecarClient> {
    if (this.client && this.status.state === 'ready') {
      return this.client;
    }

    if (this.child) {
      await this.stop();
    }

    const port = await getFreeLoopbackPort();
    this.authToken = randomUUID();
    const python = this.options.pythonExecutable ?? 'python3';
    const moduleName = this.options.moduleName ?? 'agentx_voice.server';
    const baseUrl = `http://127.0.0.1:${port}`;

    this.status = { state: 'starting', baseUrl };
    this.log('info', `Starting voice sidecar on ${baseUrl}`);

    this.stopping = false;
    const child = spawn(python, ['-m', moduleName, '--host', '127.0.0.1', '--port', String(port)], {
      env: {
        ...process.env,
        ...this.options.env,
        AGENTX_VOICE_DATA_DIR: this.options.dataDir,
        AGENTX_VOICE_AUTH_TOKEN: this.authToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.log('info', chunk.toString('utf8').trim());
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.log('warn', chunk.toString('utf8').trim());
    });

    child.on('exit', (code, signal) => {
      if (this.stopping) {
        this.status = { state: 'stopped' };
        this.stopping = false;
        return;
      }

      const error = `Voice sidecar exited with code ${code ?? 'unknown'} signal ${signal ?? 'unknown'}`;
      this.status = { state: 'crashed', baseUrl, error };
      this.client = undefined;
      this.child = undefined;
      this.log('error', error);
    });

    this.client = new VoiceSidecarClient({
      baseUrl,
      authToken: this.authToken,
      timeoutMs: this.options.requestTimeoutMs,
    });

    await this.waitForReady(this.client, this.options.startupTimeoutMs ?? 20_000);
    this.status = { state: 'ready', baseUrl, pid: child.pid };
    return this.client;
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.client = undefined;
    this.status = { state: 'stopped' };

    if (!child || child.killed) {
      return;
    }

    this.stopping = true;
    child.kill('SIGTERM');
    let exited = false;
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => {
        exited = true;
        resolve();
      })),
      delay(3_000).then(() => {
        if (!exited) {
          child.kill('SIGKILL');
        }
      }),
    ]);
  }

  private async waitForReady(client: VoiceSidecarClient, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const health = await client.health(1_000);
        if (health.ok && health.state === 'ready') {
          return;
        }
      } catch (error) {
        lastError = error;
      }

      await delay(250);
    }

    const message = lastError instanceof Error ? lastError.message : 'Timed out waiting for voice sidecar';
    this.status = { ...this.status, state: 'crashed', error: message };
    await this.stop();
    throw new Error(message);
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (message.length === 0) {
      return;
    }

    this.options.onLog?.(level, message);
  }
}

async function getFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port);
        } else {
          reject(new Error('Unable to allocate voice sidecar port'));
        }
      });
    });
  });
}
