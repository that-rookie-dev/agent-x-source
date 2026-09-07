import { exec, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { getShellCommand, getProcessListCommand } from '../platform.js';
import { DockerSandbox } from '../../sandbox/DockerSandbox.js';
import { recordCompactionFromShell } from '../../agent/compaction-file-hooks.js';
import { getAgentProcessRegistry } from '../AgentProcessRegistry.js';
import {
  buildShellEnv,
  isBlockedDownloadCommand,
  validateCommandScope,
} from '../shell-security.js';

const execAsync = promisify(exec);

let sandboxInstance: DockerSandbox | null = null;

export function setShellSandbox(sandbox: DockerSandbox | null): void {
  sandboxInstance = sandbox;
}

function shouldUseSandbox(): boolean {
  return sandboxInstance !== null && sandboxInstance.available;
}

function validateRedirects(command: string, scopePath: string): string | null {
  const redirectRe = /(?:^|\s)(?:\d*&?>[>|]?\s*)([^\s;|&`$()<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = redirectRe.exec(command)) !== null) {
    const target = m[1]!;
    if (/^\d+$/.test(target) || target.startsWith('$') || target.startsWith('{') || target.startsWith('<')) continue;
    if (target === '/dev/null' || target === '/dev/zero' || target.startsWith('/dev/fd/')) continue;
    const resolved = resolve(scopePath, target);
    if (!resolved.startsWith(scopePath)) {
      return `Redirect target "${target}" resolves outside scope (${scopePath})`;
    }
  }
  return null;
}

export async function shellExec(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  if (!command) return { success: false, output: 'No command provided', error: 'EXEC_ERROR' };
  const redirectErr = validateRedirects(command, context.scopePath);
  if (redirectErr) return { success: false, output: redirectErr, error: 'SCOPE_VIOLATION' };
  const cwd = args['cwd'] ? resolve(context.scopePath, args['cwd'] as string) : context.scopePath;
  recordCompactionFromShell(context.sessionId, context.scopePath, command, cwd);
  const scopeErr = validateCommandScope(command, context.scopePath, cwd);
  if (scopeErr) return { success: false, output: scopeErr, error: 'SCOPE_VIOLATION' };
  const downloadCheck = isBlockedDownloadCommand(command);
  if (downloadCheck.blocked) {
    return { success: false, output: downloadCheck.reason ?? 'File downloads must use http_download only.', error: 'DOWNLOAD_BLOCKED' };
  }
  const maxShellTimeout = context.voiceTurn ? 20_000 : 600_000;
  const timeout = Math.min((args['timeout'] as number) ?? 30000, maxShellTimeout);
  const maxLength = (args['maxLength'] as number) ?? 30000;

  if (shouldUseSandbox()) {
    try {
      const sandboxResult = await sandboxInstance!.exec(command, { timeout });
      const output = [sandboxResult.stdout, sandboxResult.stderr].filter(Boolean).join('\n').trim();
      const truncated = output.length > maxLength ? output.slice(0, maxLength) + `\n… [output truncated at ${maxLength} chars]` : output;
      return {
        success: sandboxResult.exitCode === 0,
        output: truncated || `Process exited with code ${sandboxResult.exitCode}`,
        error: sandboxResult.exitCode !== 0 ? 'EXEC_ERROR' : undefined,
        metadata: { exitCode: sandboxResult.exitCode, sandboxed: true },
      };
    } catch (err) {
      return { success: false, output: `Sandbox execution failed: ${(err as Error).message}`, error: 'SANDBOX_ERROR' };
    }
  }

  const shell = getShellCommand(command);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      encoding: 'utf-8',
      shell: shell.cmd,
      maxBuffer: 10 * 1024 * 1024,
      env: buildShellEnv(cwd),
    });
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    const truncated = combined.length > maxLength ? combined.slice(0, maxLength) + `\n… [output truncated at ${maxLength} chars]` : combined;
    return { success: true, output: truncated, metadata: { exitCode: 0 } };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string; code?: number };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    const truncated = output.length > maxLength ? output.slice(0, maxLength) + `\n… [output truncated at ${maxLength} chars]` : output;
    return {
      success: false,
      output: truncated,
      error: 'EXEC_ERROR',
      metadata: { exitCode: err.code },
    };
  }
}

export async function shellBackground(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  if (!command) return { success: false, output: 'No command provided', error: 'EXEC_ERROR' };
  const redirectErr = validateRedirects(command, context.scopePath);
  if (redirectErr) return { success: false, output: redirectErr, error: 'SCOPE_VIOLATION' };
  const cwd = args['cwd'] ? resolve(context.scopePath, args['cwd'] as string) : context.scopePath;
  const scopeErr = validateCommandScope(command, context.scopePath, cwd);
  if (scopeErr) return { success: false, output: scopeErr, error: 'SCOPE_VIOLATION' };
  const downloadCheck = isBlockedDownloadCommand(command);
  if (downloadCheck.blocked) {
    return { success: false, output: downloadCheck.reason ?? 'File downloads must use http_download only.', error: 'DOWNLOAD_BLOCKED' };
  }

  try {
    const shell = getShellCommand(command);
    const child = spawn(shell.cmd, shell.args, {
      cwd,
      detached: true,
      // stdin ignored, stdout/stderr piped so the Process Supervisor (AgentProcessRegistry)
      // can capture a bounded log tail — needed to give the user something useful ("crashed
      // with: <last lines>") instead of just "the process is no longer running" when a
      // long-running dev server/background job dies unexpectedly.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildShellEnv(cwd),
    });
    child.unref();
    const registry = getAgentProcessRegistry();
    registry.track(child, {
      command,
      sessionId: context.sessionId,
      scopePath: context.scopePath,
      cwd,
      detached: true,
    });
    if (child.pid) {
      const pid = child.pid;
      child.stdout?.on('data', (data: Buffer) => registry.appendLog(pid, data.toString()));
      child.stderr?.on('data', (data: Buffer) => registry.appendLog(pid, data.toString()));
    }
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

  if (!pid || pid <= 0) {
    return { success: false, output: 'Invalid PID', error: 'KILL_ERROR' };
  }
  if (!getAgentProcessRegistry().isTracked(pid)) {
    return {
      success: false,
      output: `PID ${pid} was not started by Agent-X shell tools — kill denied for safety`,
      error: 'KILL_DENIED',
    };
  }

  const ok = getAgentProcessRegistry().kill(pid, signal);
  if (!ok) {
    return { success: false, output: `Failed to kill process ${pid}`, error: 'KILL_ERROR' };
  }
  return { success: true, output: `Sent ${signal} to PID ${pid}` };
}

export async function processList(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  try {
    const cmd = getProcessListCommand();
    const { stdout } = await execAsync(cmd, {
      cwd: context.scopePath,
      encoding: 'utf-8',
      timeout: 5000,
      env: buildShellEnv(context.scopePath),
    });
    return { success: true, output: stdout.trim() };
  } catch (error) {
    return { success: false, output: `Failed to list processes: ${(error as Error).message}`, error: 'PS_ERROR' };
  }
}

export async function shellExecStreaming(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  if (!command) return { success: false, output: 'No command provided', error: 'EXEC_ERROR' };
  const redirectErr = validateRedirects(command, context.scopePath);
  if (redirectErr) return { success: false, output: redirectErr, error: 'SCOPE_VIOLATION' };
  const cwd = args['cwd'] ? resolve(context.scopePath, args['cwd'] as string) : context.scopePath;
  const scopeErr = validateCommandScope(command, context.scopePath, cwd);
  if (scopeErr) return { success: false, output: scopeErr, error: 'SCOPE_VIOLATION' };
  const maxLength = (args['maxLength'] as number) ?? 30000;
  const shell = getShellCommand(command);

  return new Promise((resolvePromise) => {
    // Do not set shell:true — getShellCommand already returns an absolute
    // shell + ['-c', command]. shell:true would re-spawn a bare `sh` via PATH
    // and can throw "spawn sh ENOENT" under Electron.
    const child = spawn(shell.cmd, shell.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildShellEnv(cwd),
    });
    getAgentProcessRegistry().track(child, {
      command,
      sessionId: context.sessionId,
      scopePath: context.scopePath,
      cwd,
      detached: false,
    });

    let stdout = '';
    let stderr = '';
    const maxBuffer = 100 * 1024;
    const onOutput = context.onOutput;

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer);
      onOutput?.(chunk);
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
      onOutput?.(chunk);
    });

    child.on('close', (code) => {
      if (child.pid) getAgentProcessRegistry().untrack(child.pid);
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      const truncated = output.length > maxLength ? output.slice(0, maxLength) + `\n… [output truncated at ${maxLength} chars]` : output;
      resolvePromise({
        success: code === 0,
        output: truncated || `Process exited with code ${code}`,
        metadata: { exitCode: code },
        error: code !== 0 ? 'EXEC_ERROR' : undefined,
      } as ToolResult);
    });

    child.on('error', (err) => {
      if (child.pid) getAgentProcessRegistry().untrack(child.pid);
      resolvePromise({ success: false, output: `Failed to start: ${err.message}`, error: 'SPAWN_ERROR' });
    });
  });
}
