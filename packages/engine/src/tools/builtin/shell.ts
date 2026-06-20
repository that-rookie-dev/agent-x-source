import { execSync, spawn } from 'node:child_process';
import { resolve, normalize } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_WINDOWS, getShellCommand, getProcessListCommand } from '../platform.js';

function validateRedirects(command: string, scopePath: string): string | null {
  // Match shell redirects: > file, >> file, 2> file, &> file, >| file
  // Exclude file descriptor duplications: >&2, 2>&1, 1>&2
  const redirectRe = /(?:^|\s)(?:\d*&?>[>|]?\s*)([^\s;|&`$()<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = redirectRe.exec(command)) !== null) {
    const target = m[1]!;
    // Skip fd targets (e.g. "1" or "2") and variables/heredocs
    if (/^\d+$/.test(target) || target.startsWith('$') || target.startsWith('{') || target.startsWith('<')) continue;
    // Safe pseudo-files — allowed regardless of scope
    if (target === '/dev/null' || target === '/dev/zero' || target.startsWith('/dev/fd/')) continue;
    const resolved = normalize(resolve(scopePath, target));
    if (!resolved.startsWith(scopePath)) {
      return `Redirect target "${target}" resolves to "${resolved}" which is outside scope (${scopePath})`;
    }
  }
  return null;
}

function validateCommandScope(command: string, scopePath: string): string | null {
  const tokens = tokenizeShell(command);
  for (const token of tokens) {
    const raw = token.replace(/[;,|&()]+$/, '');
    if (!raw.startsWith('/') && !(IS_WINDOWS && /^[A-Z]:[\\/]/i.test(raw))) continue;
    if (raw === '/dev/null' || raw === '/dev/zero' || raw.startsWith('/dev/fd/')) continue;
    if (raw.startsWith('/proc/')) continue;
    const resolved = normalize(resolve(scopePath, raw));
    if (!resolved.startsWith(scopePath)) {
      return `Path "${raw}" in command is outside scope (${scopePath})`;
    }
  }
  return null;
}

function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let inSingle = false;
  let inDouble = false;
  for (const c of command) {
    if (c === '\'' && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) { token += c; continue; }
    if (/\s/.test(c) || ';|&()'.includes(c)) {
      if (token) { tokens.push(token); token = ''; }
      continue;
    }
    token += c;
  }
  if (token) tokens.push(token);
  return tokens;
}

export async function shellExec(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  if (!command) return { success: false, output: 'No command provided', error: 'EXEC_ERROR' };
  const redirectErr = validateRedirects(command, context.scopePath);
  if (redirectErr) return { success: false, output: redirectErr, error: 'SCOPE_VIOLATION' };
  const scopeErr = validateCommandScope(command, context.scopePath);
  if (scopeErr) return { success: false, output: scopeErr, error: 'SCOPE_VIOLATION' };
  const cwd = args['cwd'] ? resolve(context.scopePath, args['cwd'] as string) : context.scopePath;
  const timeout = (args['timeout'] as number) ?? 30000;
  const maxLength = (args['maxLength'] as number) ?? 30000;

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
    const trimmed = output.trim();
    const truncated = trimmed.length > maxLength ? trimmed.slice(0, maxLength) + `\n… [output truncated at ${maxLength} chars]` : trimmed;
    return { success: true, output: truncated };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string; status?: number };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    const truncated = output.length > maxLength ? output.slice(0, maxLength) + `\n… [output truncated at ${maxLength} chars]` : output;
    return {
      success: false,
      output: truncated,
      error: 'EXEC_ERROR',
      metadata: { exitCode: err.status },
    };
  }
}

export async function shellBackground(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  if (!command) return { success: false, output: 'No command provided', error: 'EXEC_ERROR' };
  const redirectErr = validateRedirects(command, context.scopePath);
  if (redirectErr) return { success: false, output: redirectErr, error: 'SCOPE_VIOLATION' };
  const scopeErr = validateCommandScope(command, context.scopePath);
  if (scopeErr) return { success: false, output: scopeErr, error: 'SCOPE_VIOLATION' };
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

export async function shellExecStreaming(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  if (!command) return { success: false, output: 'No command provided', error: 'EXEC_ERROR' };
  const redirectErr = validateRedirects(command, context.scopePath);
  if (redirectErr) return { success: false, output: redirectErr, error: 'SCOPE_VIOLATION' };
  const scopeErr = validateCommandScope(command, context.scopePath);
  if (scopeErr) return { success: false, output: scopeErr, error: 'SCOPE_VIOLATION' };
  const cwd = args['cwd'] ? resolve(context.scopePath, args['cwd'] as string) : context.scopePath;
  const maxLength = (args['maxLength'] as number) ?? 30000;
  const shell = getShellCommand(command);

  return new Promise((resolvePromise) => {
    const child = spawn(shell.cmd, shell.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb' },
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    const maxBuffer = 100 * 1024;

    const onOutput = context.onOutput;

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      if (stdout.length > maxBuffer) {
        stdout = stdout.slice(-maxBuffer);
      }
      onOutput?.(chunk);
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (stderr.length > maxBuffer) {
        stderr = stderr.slice(-maxBuffer);
      }
      onOutput?.(chunk);
    });

    child.on('close', (code) => {
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
      resolvePromise({ success: false, output: `Failed to start: ${err.message}`, error: 'SPAWN_ERROR' });
    });
  });
}
