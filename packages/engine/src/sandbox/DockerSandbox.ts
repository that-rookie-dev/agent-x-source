import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Sandbox, SandboxResult, SandboxOptions } from '@agentx/shared';

interface ContainerProcess {
  pid: number;
  command: string;
  containerId: string;
  started: number;
}

export class DockerSandbox implements Sandbox {
  readonly name = 'docker';
  readonly available: boolean;
  private baseImage: string;
  private processes: Map<number, ContainerProcess> = new Map();
  private nextPid = 1000;
  private workDir: string;
  private tempDirs: Set<string> = new Set();
  private projectDir: string | null = null;

  constructor(baseImage = 'node:20-slim') {
    this.baseImage = baseImage;
    this.workDir = join(tmpdir(), 'agentx-sandbox');
    if (!existsSync(this.workDir)) {
      mkdirSync(this.workDir, { recursive: true });
    }
    this.available = this.checkDocker();
  }

  /** Set a project directory to bind-mount instead of using isolated temp dirs */
  setProjectDir(dir: string): void {
    if (existsSync(dir)) {
      this.projectDir = dir;
    }
  }

  async exec(command: string, options?: SandboxOptions): Promise<SandboxResult> {
    const startTime = Date.now();
    const containerId = this.generateId();
    const workDir = this.prepareWorkDir(options);

    try {
      const args = this.buildExecArgs(containerId, command, workDir, options);
      const output = await this.runContainer(args, options?.timeout ?? 60_000);

      return {
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: (error as Error).message,
        exitCode: -1,
        duration: Date.now() - startTime,
        error: (error as Error).message,
      };
    } finally {
      this.cleanupContainer(containerId);
    }
  }

  async execBackground(command: string, options?: SandboxOptions): Promise<{ pid: number }> {
    const containerId = this.generateId();
    const pid = this.nextPid++;
    const workDir = this.prepareWorkDir(options);

    const args = [
      'run',
      '--detach',
      '--name', containerId,
      ...this.buildResourceLimits(options),
      ...this.buildNetworkConfig(options),
      '--workdir', '/workspace',
      ...this.buildVolumeMounts(workDir),
      this.baseImage,
      'sh', '-c', command,
    ];

    try {
      execSync(`docker ${args.join(' ')}`, { timeout: 10_000, stdio: 'pipe' });
    } catch (error) {
      throw new Error(`Failed to start background container: ${(error as Error).message}`);
    }

    this.processes.set(pid, { pid, command, containerId, started: Date.now() });
    return { pid };
  }

  async kill(pid: number): Promise<boolean> {
    const proc = this.processes.get(pid);
    if (!proc) return false;

    try {
      execSync(`docker kill ${proc.containerId}`, { timeout: 10_000, stdio: 'pipe' });
      execSync(`docker rm --force ${proc.containerId}`, { timeout: 10_000, stdio: 'pipe' });
      this.processes.delete(pid);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<Array<{ pid: number; command: string }>> {
    return [...this.processes.values()].map((p) => ({ pid: p.pid, command: p.command }));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const hostPath = this.sandboxPath(path);
    const dir = hostPath.substring(0, hostPath.lastIndexOf('/'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(hostPath, content, 'utf-8');
  }

  async readFile(path: string): Promise<string> {
    const hostPath = this.sandboxPath(path);
    if (!existsSync(hostPath)) {
      throw new Error(`File not found: ${path}`);
    }
    return readFileSync(hostPath, 'utf-8');
  }

  async dispose(): Promise<void> {
    // Kill all running containers
    for (const pid of this.processes.keys()) {
      await this.kill(pid);
    }
    // Cleanup temp directories
    for (const dir of this.tempDirs) {
      try {
        execSync(`rm -rf ${dir}`, { timeout: 10_000 });
      } catch {
        // Best-effort
      }
    }
    this.tempDirs.clear();
  }

  private checkDocker(): boolean {
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private generateId(): string {
    return randomUUID();
  }

  private prepareWorkDir(_options?: SandboxOptions): string {
    const dir = join(this.workDir, randomBytes(4).toString('hex'));
    mkdirSync(dir, { recursive: true });
    this.tempDirs.add(dir);
    return dir;
  }

  private buildExecArgs(
    containerId: string,
    command: string,
    workDir: string,
    options?: SandboxOptions,
  ): string[] {
    return [
      'run',
      '--rm',
      '--name', containerId,
      ...this.buildResourceLimits(options),
      ...this.buildNetworkConfig(options),
      '--workdir', '/workspace',
      ...this.buildVolumeMounts(workDir),
      this.baseImage,
      'sh', '-c', command,
    ];
  }

  private buildResourceLimits(options?: SandboxOptions): string[] {
    const args: string[] = [];
    if (options?.memoryLimit) {
      args.push('--memory', `${options.memoryLimit}m`);
    }
    return args;
  }

  private buildNetworkConfig(options?: SandboxOptions): string[] {
    if (options?.networkAccess === false) {
      return ['--network', 'none'];
    }
    return [];
  }

  private buildVolumeMounts(workDir: string): string[] {
    const mounts: string[] = [];
    if (this.projectDir) {
      // Bind-mount project directory for persistent file access
      mounts.push('-v', `${this.projectDir}:/workspace`);
    } else {
      // Isolated temp dir for sandboxed execution
      mounts.push('-v', `${workDir}:/workspace`);
    }
    return mounts;
  }

  private sandboxPath(path: string): string {
    // Map relative paths to the current working temp directory
    if (path.startsWith('/')) {
      // Absolute path — map to last temp dir
      const dirs = [...this.tempDirs];
      const last = dirs[dirs.length - 1];
      return join(last ?? this.workDir, path);
    }
    const dirs = [...this.tempDirs];
    const last = dirs[dirs.length - 1];
    return join(last ?? this.workDir, path);
  }

  private async runContainer(
    args: string[],
    timeout: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Container execution timed out'));
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private cleanupContainer(containerId: string): void {
    try {
      execSync(`docker rm --force ${containerId} 2>/dev/null`, { timeout: 5000 });
    } catch {
      // Best-effort cleanup
    }
  }
}
