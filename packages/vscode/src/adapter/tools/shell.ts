import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptShellProcess(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const ws = ctx.workspaceRoot;

  // ── shell_exec ──
  refs.executor.registerHandler('shell_exec', async (args, _context): Promise<ToolResult> => {
    const command = args['command'] as string;
    const cwd = args['cwd'] ? resolve(ws, args['cwd'] as string) : ws;
    const timeout = Math.min((args['timeout'] as number) ?? 30000, 600000);
    const maxLength = (args['maxLength'] as number) ?? 30000;

    try {
      const output = execSync(command, {
        cwd,
        timeout,
        encoding: 'utf-8',
        shell: '/bin/bash',
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, TERM: 'dumb' },
      });
      const trimmed = output.trim();
      const truncated = trimmed.length > maxLength
        ? trimmed.slice(0, maxLength) + `\n... [output truncated at ${maxLength} chars]`
        : trimmed;
      return { success: true, output: truncated };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message: string; status?: number };
      const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
      const truncated = output.length > maxLength
        ? output.slice(0, maxLength) + `\n... [output truncated at ${maxLength} chars]`
        : output;
      return { success: false, output: truncated, error: 'EXEC_ERROR', metadata: { exitCode: err.status } };
    }
  });
  result.overridden.push('shell_exec');

  // ── shell_exec_streaming ──
  refs.executor.registerHandler('shell_exec_streaming', async (args, _context): Promise<ToolResult> => {
    const command = args['command'] as string;
    const cwd = args['cwd'] ? resolve(ws, args['cwd'] as string) : ws;
    const maxLength = (args['maxLength'] as number) ?? 30000;

    return new Promise((resolvePromise) => {
      const child = spawn('/bin/bash', ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'dumb' },
      });

      let stdout = '';
      let stderr = '';
      const maxBuffer = 100 * 1024;

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer);
        ctx.outputChannel.append(chunk);
      });

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
        ctx.outputChannel.append(chunk);
      });

      child.on('close', (code) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        const truncated = output.length > maxLength
          ? output.slice(0, maxLength) + `\n... [output truncated at ${maxLength} chars]`
          : output;
        resolvePromise({
          success: code === 0,
          output: truncated || `Process exited with code ${code}`,
          metadata: { exitCode: code },
          error: code !== 0 ? 'EXEC_ERROR' : undefined,
        });
      });

      child.on('error', (err) => {
        resolvePromise({ success: false, output: `Failed to start: ${err.message}`, error: 'SPAWN_ERROR' });
      });
    });
  });
  result.overridden.push('shell_exec_streaming');

  // ── Kept as-is ──
  result.keptAsIs.push('shell_background', 'process_kill', 'process_list');

  return result;
}
