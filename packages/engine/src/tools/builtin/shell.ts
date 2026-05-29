import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_WINDOWS, getShellCommand, getProcessListCommand } from '../platform.js';

export async function shellExec(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  const cwd = args['cwd'] ? resolve(context.scopePath, args['cwd'] as string) : context.scopePath;
  const timeout = (args['timeout'] as number) ?? 30000;

  const shell = getShellCommand(command);
  try {
    const output = execSync(command, {
      cwd,
      timeout,
      encoding: 'utf-8',
      shell: shell.cmd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, TERM: 'dumb' },
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string; status?: number };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return {
      success: false,
      output,
      error: 'EXEC_ERROR',
      metadata: { exitCode: err.status },
    };
  }
}

export async function shellBackground(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  const cwd = args['cwd'] ? resolve(context.scopePath, args['cwd'] as string) : context.scopePath;

  try {
    const shell = getShellCommand(command);
    const child = spawn(shell.cmd, shell.args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, TERM: 'dumb' },
    });
    child.unref();
    return {
      success: true,
      output: `Background process started (PID: ${child.pid})`,
      metadata: { pid: child.pid },
    };
  } catch (error) {
    return { success: false, output: `Failed to start background process: ${(error as Error).message}`, error: 'SPAWN_ERROR' };
  }
}

export async function processKill(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args['pid'] as number;
  const signal = (args['signal'] as string) ?? 'SIGTERM';

  try {
    if (IS_WINDOWS && signal === 'SIGTERM') {
      execSync(`taskkill /PID ${pid} /F 2>nul`, { encoding: 'utf-8' });
      return { success: true, output: `Killed PID ${pid}` };
    }
    process.kill(pid, signal);
    return { success: true, output: `Sent ${signal} to PID ${pid}` };
  } catch (error) {
    return { success: false, output: `Failed to kill process: ${(error as Error).message}`, error: 'KILL_ERROR' };
  }
}

export async function processList(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  try {
    const cmd = getProcessListCommand();
    const output = execSync(cmd, {
      cwd: context.scopePath,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, output: `Failed to list processes: ${(error as Error).message}`, error: 'PS_ERROR' };
  }
}
