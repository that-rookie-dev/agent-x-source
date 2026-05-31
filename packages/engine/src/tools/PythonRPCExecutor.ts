import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface PythonTask {
  id: string;
  script: string;
  args: Record<string, unknown>;
  timeout: number;
  workDir?: string;
}

export interface PythonResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsed: number;
}

/**
 * Python RPC Executor — executes Python scripts in isolated subprocesses
 * for zero-context-cost pipelines inside sub-agents.
 *
 * Supports:
 * - Script execution with args (passed as JSON env vars)
 * - Timeout enforcement
 * - Isolated work directories
 * - Result capture (stdout/stderr/exit code)
 * - Streaming output
 * - Virtual environment auto-detection
 */
export class PythonRPCExecutor {
  private pythonPath = 'python3';
  private activeProcesses = new Map<string, ChildProcess>();
  private tempDirs: string[] = [];

  constructor(pythonPath?: string) {
    if (pythonPath) this.pythonPath = pythonPath;
    this.detectPython();
  }

  private detectPython(): void {
    for (const cmd of ['python3', 'python', 'python3.11', 'python3.12', 'python3.13']) {
      try {
        execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 3000 });
        this.pythonPath = cmd;
        logger.info('PYTHON_RPC', `Using python: ${cmd}`);
        return;
      } catch { /* try next */ }
    }
    logger.warn('PYTHON_RPC', 'No python found — RPC scripts will fail');
  }

  /**
   * Execute a Python script synchronously and return the result.
   */
  executeScript(script: string, args: Record<string, unknown> = {}, opts: {
    timeout?: number;
    workDir?: string;
    env?: Record<string, string>;
  } = {}): PythonResult {
    const start = Date.now();
    const workDir = opts.workDir || this.createWorkDir();

    // Write script to file
    const scriptPath = join(workDir, `rpc_${Date.now()}.py`);
    writeFileSync(scriptPath, script, 'utf-8');

    // Pass args as JSON via env var
    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHON_RPC_ARGS: JSON.stringify(args),
      ...opts.env,
    };

    try {
      const stdout = execSync(`${this.pythonPath} "${scriptPath}"`, {
        timeout: opts.timeout || 60000,
        encoding: 'utf-8',
        cwd: workDir,
        env,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        success: true,
        stdout: stdout as string,
        stderr: '',
        exitCode: 0,
        elapsed: Date.now() - start,
      };
    } catch (error) {
      const err = error as { stdout?: Buffer; stderr?: Buffer; status?: number };
      return {
        success: false,
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || '',
        exitCode: err.status || 1,
        elapsed: Date.now() - start,
      };
    } finally {
      // Clean up script
      try { rmSync(scriptPath, { force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * Execute a Python script with streaming output.
   * Yields lines of stdout as they arrive.
   */
  async *executeStreaming(
    script: string,
    args: Record<string, unknown> = {},
    opts: { timeout?: number; workDir?: string } = {},
  ): AsyncGenerator<{ type: 'stdout' | 'stderr' | 'exit'; line?: string; exitCode?: number }> {
    const workDir = opts.workDir || this.createWorkDir();
    const scriptPath = join(workDir, `rpc_stream_${Date.now()}.py`);
    writeFileSync(scriptPath, script, 'utf-8');

    const env = { ...process.env, PYTHON_RPC_ARGS: JSON.stringify(args) };

    const proc = spawn(this.pythonPath, [scriptPath], {
      timeout: opts.timeout || 60000,
      cwd: workDir,
      env,
    });

    const procId = `rpc-${Date.now()}`;
    this.activeProcesses.set(procId, proc);

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
    }, opts.timeout || 60000);

    try {
      if (proc.stdout) {
        for await (const chunk of proc.stdout) {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line) yield { type: 'stdout', line };
          }
        }
      }
      if (proc.stderr) {
        for await (const chunk of proc.stderr) {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line) yield { type: 'stderr', line };
          }
        }
      }
      const exitCode = await new Promise<number>((resolve) => {
        proc.on('close', resolve);
      });
      clearTimeout(timeoutId);
      yield { type: 'exit', exitCode };
    } finally {
      clearTimeout(timeoutId);
      this.activeProcesses.delete(procId);
      try { rmSync(scriptPath, { force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * Install Python packages in the work directory.
   */
  pipInstall(packages: string[], workDir?: string): { success: boolean; output: string } {
    const dir = workDir || this.createWorkDir();
    try {
      const output = execSync(
        `${this.pythonPath} -m pip install ${packages.join(' ')} --quiet --target "${dir}"`,
        { timeout: 60000, encoding: 'utf-8', stdio: 'pipe' },
      );
      return { success: true, output: output as string };
    } catch (error) {
      return { success: false, output: (error as Error).message };
    }
  }

  /**
   * Check if a Python package is available.
   */
  checkPackage(packageName: string): boolean {
    try {
      execSync(`${this.pythonPath} -c "import ${packageName}"`, {
        stdio: 'pipe', timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  kill(procId: string): void {
    const proc = this.activeProcesses.get(procId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(procId);
    }
  }

  killAll(): void {
    for (const [, proc] of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }

  private createWorkDir(): string {
    const dir = join(tmpdir(), `agentx-python-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
    this.tempDirs.push(dir);
    if (this.tempDirs.length > 20) {
      const old = this.tempDirs.shift()!;
      try { rmSync(old, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return dir;
  }

  cleanup(): void {
    this.killAll();
    for (const dir of this.tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    this.tempDirs = [];
  }
}

/**
 * Default Python RPC executor instance.
 */
let defaultExecutor: PythonRPCExecutor | null = null;

export function getPythonRPC(): PythonRPCExecutor {
  if (!defaultExecutor) defaultExecutor = new PythonRPCExecutor();
  return defaultExecutor;
}
