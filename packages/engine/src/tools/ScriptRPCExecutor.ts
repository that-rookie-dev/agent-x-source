import { exec, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { getLogger } from '@agentx/shared';

const execAsync = promisify(exec);

const logger = getLogger();

export type ScriptLanguage = 'auto' | 'javascript' | 'typescript' | 'python' | 'bash';

export interface ScriptResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsed: number;
  runtime: string;
}

const JS_PREAMBLE = `const __args = JSON.parse(process.env.SCRIPT_RPC_ARGS || '{}');\n`;
const PY_PREAMBLE = `import json, os\n__args = json.loads(os.environ.get('SCRIPT_RPC_ARGS', '{}'))\n`;

/**
 * Lightweight multi-runtime script executor — Node/TS/Python/Bash without requiring Python when JS suffices.
 */
export class ScriptRPCExecutor {
  private pythonPath = 'python3';
  private nodePath = 'node';
  private tsxPath: string | null = null;
  private activeProcesses = new Map<string, ChildProcess>();
  private tempDirs: string[] = [];
  private runtimeDetection: Promise<void>;

  constructor() {
    this.runtimeDetection = this.detectRuntimes();
  }

  private async detectRuntimes(): Promise<void> {
    for (const cmd of ['node', 'nodejs']) {
      try {
        await execAsync(`${cmd} --version`, { timeout: 3000 });
        this.nodePath = cmd;
        break;
      } catch { /* try next */ }
    }
    for (const cmd of ['python3', 'python', 'python3.12', 'python3.11']) {
      try {
        await execAsync(`${cmd} --version`, { timeout: 3000 });
        this.pythonPath = cmd;
        break;
      } catch { /* try next */ }
    }
    for (const cmd of ['tsx', 'npx tsx', 'npx ts-node']) {
      try {
        await execAsync(`${cmd} --version`, { timeout: 5000 });
        this.tsxPath = cmd;
        break;
      } catch { /* try next */ }
    }
    logger.info('SCRIPT_RPC', `runtimes: node=${this.nodePath}, python=${this.pythonPath}, tsx=${this.tsxPath ?? 'none'}`);
  }

  resolveLanguage(language: ScriptLanguage, scopePath: string): Exclude<ScriptLanguage, 'auto'> {
    if (language !== 'auto') return language;
    const root = resolve(scopePath);
    const hasPkg = existsSync(join(root, 'package.json'));
    const hasPy = existsSync(join(root, 'pyproject.toml'))
      || existsSync(join(root, 'requirements.txt'))
      || existsSync(join(root, 'setup.py'));
    if (hasPkg && !hasPy) return 'javascript';
    if (hasPy && !hasPkg) return 'python';
    if (hasPkg) return 'javascript';
    return 'javascript';
  }

  async executeScript(
    script: string,
    language: ScriptLanguage,
    args: Record<string, unknown> = {},
    opts: { timeout?: number; workDir?: string; scopePath?: string } = {},
  ): Promise<ScriptResult> {
    await this.runtimeDetection;
    const start = Date.now();
    const scopePath = opts.scopePath ?? process.cwd();
    const resolved = this.resolveLanguage(language, scopePath);
    const workDir = opts.workDir ?? this.createWorkDir();
    const timeout = opts.timeout ?? 60_000;
    const env = {
      ...process.env,
      SCRIPT_RPC_ARGS: JSON.stringify(args),
      PYTHON_RPC_ARGS: JSON.stringify(args),
    };

    let scriptPath: string;
    let command: string;

    switch (resolved) {
      case 'typescript': {
        const useTsx = this.tsxPath ?? 'npx tsx';
        scriptPath = join(workDir, `rpc_${Date.now()}.ts`);
        writeFileSync(scriptPath, JS_PREAMBLE.replace('process.env', 'process.env') + script, 'utf-8');
        command = `${useTsx} "${scriptPath}"`;
        break;
      }
      case 'javascript': {
        scriptPath = join(workDir, `rpc_${Date.now()}.mjs`);
        writeFileSync(scriptPath, JS_PREAMBLE + script, 'utf-8');
        command = `${this.nodePath} "${scriptPath}"`;
        break;
      }
      case 'python': {
        scriptPath = join(workDir, `rpc_${Date.now()}.py`);
        writeFileSync(scriptPath, PY_PREAMBLE + script, 'utf-8');
        command = `${this.pythonPath} "${scriptPath}"`;
        break;
      }
      case 'bash': {
        scriptPath = join(workDir, `rpc_${Date.now()}.sh`);
        writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n__ARGS='${JSON.stringify(args).replace(/'/g, "'\\''")}'\n${script}\n`, 'utf-8');
        command = `bash "${scriptPath}"`;
        break;
      }
      default:
        return { success: false, stdout: '', stderr: `Unsupported language: ${resolved}`, exitCode: 1, elapsed: 0, runtime: resolved };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        encoding: 'utf-8',
        cwd: workDir,
        env,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        success: true,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: 0,
        elapsed: Date.now() - start,
        runtime: resolved,
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        success: false,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.code ?? 1,
        elapsed: Date.now() - start,
        runtime: resolved,
      };
    } finally {
      try { rmSync(scriptPath!, { force: true }); } catch { /* ignore */ }
    }
  }

  /** One-liner eval — JavaScript/TypeScript only; Python/Bash use file mode. */
  async evalSnippet(
    code: string,
    language: ScriptLanguage,
    args: Record<string, unknown> = {},
    opts: { timeout?: number; scopePath?: string } = {},
  ): Promise<ScriptResult> {
    await this.runtimeDetection;
    const start = Date.now();
    const scopePath = opts.scopePath ?? process.cwd();
    let resolved = this.resolveLanguage(language, scopePath);
    if (resolved === 'python' || resolved === 'bash') {
      return this.executeScript(code, resolved, args, opts);
    }
    if (resolved === 'typescript' && !this.tsxPath) resolved = 'javascript';

    const timeout = opts.timeout ?? 30_000;
    const env = {
      ...process.env,
      SCRIPT_RPC_ARGS: JSON.stringify(args),
    };
    const wrapped = `${JS_PREAMBLE}${code}`;
    const command = `${this.nodePath} -e ${JSON.stringify(wrapped)}`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        encoding: 'utf-8',
        cwd: scopePath,
        env,
        maxBuffer: 5 * 1024 * 1024,
      });
      return { success: true, stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0, elapsed: Date.now() - start, runtime: resolved };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        success: false,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.code ?? 1,
        elapsed: Date.now() - start,
        runtime: resolved,
      };
    }
  }

  private createWorkDir(): string {
    const dir = join(tmpdir(), `agentx-script-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    this.tempDirs.push(dir);
    if (this.tempDirs.length > 20) {
      const old = this.tempDirs.shift()!;
      try { rmSync(old, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return dir;
  }

  cleanup(): void {
    for (const [, proc] of this.activeProcesses) proc.kill('SIGTERM');
    this.activeProcesses.clear();
    for (const dir of this.tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    this.tempDirs = [];
  }
}

let defaultExecutor: ScriptRPCExecutor | null = null;

export function getScriptRPC(): ScriptRPCExecutor {
  if (!defaultExecutor) defaultExecutor = new ScriptRPCExecutor();
  return defaultExecutor;
}

/** Detect project stack from scope path for routing hints. */
export function detectProjectStack(scopePath: string): { primary: ScriptLanguage; hasNode: boolean; hasPython: boolean } {
  const root = resolve(scopePath);
  const hasNode = existsSync(join(root, 'package.json'));
  const hasPython = existsSync(join(root, 'pyproject.toml'))
    || existsSync(join(root, 'requirements.txt'))
    || existsSync(join(root, 'setup.py'));
  let primary: ScriptLanguage = 'javascript';
  if (hasPython && !hasNode) primary = 'python';
  else if (hasNode) primary = existsSync(join(root, 'tsconfig.json')) ? 'typescript' : 'javascript';
  return { primary, hasNode, hasPython };
}
