import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function gitStatus(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return gitCommand('status --short', context);
}

export async function gitDiff(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const ref = args['ref'] as string | undefined;
  const file = (args['path'] ?? args['file']) as string | undefined;
  let cmd = 'diff';
  if (ref) cmd += ` ${ref}`;
  if (file) cmd += ` -- ${file}`;
  return gitCommand(cmd, context);
}

export async function gitLog(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const count = (args['count'] as number) ?? 10;
  const oneline = args['oneline'] !== false;
  let cmd = `log -${count}`;
  if (oneline) cmd += ' --oneline';
  return gitCommand(cmd, context);
}

export async function gitCommit(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const message = args['message'] as string;
  const files = args['files'] as string | undefined;

  // Stage files if provided
  if (files) {
    const addResult = await gitCommand(`add ${files}`, context);
    if (!addResult.success) return addResult;
  }

  const cmd = `commit -m "${message.replace(/"/g, '\\"')}"`;
  return gitCommand(cmd, context);
}

export async function gitAdd(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const files = args['files'] as string[] | string;
  const paths = Array.isArray(files) ? files.join(' ') : files;
  return gitCommand(`add ${paths}`, context);
}

export async function gitBranch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const name = args['name'] as string | undefined;
  const del = args['delete'] as boolean;
  if (!name) return gitCommand('branch -a', context);
  if (del) return gitCommand(`branch -d ${name}`, context);
  return gitCommand(`checkout -b ${name}`, context);
}

export async function gitCheckout(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const target = args['target'] as string;
  return gitCommand(`checkout ${target}`, context);
}

export async function gitStash(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const action = (args['action'] as string) ?? 'push';
  return gitCommand(`stash ${action}`, context);
}

export async function gitBlame(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const startLine = args['startLine'] as number | undefined;
  const endLine = args['endLine'] as number | undefined;
  let cmd = `blame ${file}`;
  if (startLine && endLine) cmd += ` -L ${startLine},${endLine}`;
  return gitCommand(cmd, context);
}

export async function gitShow(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const ref = (args['ref'] as string) ?? 'HEAD';
  return gitCommand(`show ${ref} --stat`, context);
}

function gitCommand(cmd: string, context: ToolExecutionContext): ToolResult {
  const cwd = resolve(context.scopePath);
  try {
    const output = execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { success: true, output: output.trim() || '(no output)' };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'GIT_ERROR' };
  }
}
