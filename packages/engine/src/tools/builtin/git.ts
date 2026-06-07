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

export async function gitPush(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const remote = (args['remote'] as string) ?? 'origin';
  const branch = args['branch'] as string | undefined;
  let cmd = `push ${remote}`;
  if (branch) cmd += ` ${branch}`;
  return gitCommand(cmd, context);
}

export async function gitPull(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const remote = (args['remote'] as string) ?? 'origin';
  const branch = args['branch'] as string | undefined;
  let cmd = `pull ${remote}`;
  if (branch) cmd += ` ${branch}`;
  return gitCommand(cmd, context);
}

export async function gitMerge(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const branch = args['branch'] as string;
  const noFf = args['no_ff'] as boolean;
  let cmd = `merge ${branch}`;
  if (noFf) cmd += ' --no-ff';
  return gitCommand(cmd, context);
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

export async function gitInit(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const bare = args['bare'] as boolean;
  let cmd = 'init';
  if (bare) cmd += ' --bare';
  return gitCommand(cmd, context);
}

export async function gitClone(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const dir = args['directory'] as string | undefined;
  let cmd = `clone ${url}`;
  if (dir) cmd += ` ${dir}`;
  return gitCommand(cmd, context);
}

export async function gitRemote(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const action = (args['action'] as string) ?? 'list';
  const name = args['name'] as string | undefined;
  const url = args['url'] as string | undefined;
  if (action === 'add' && name && url) return gitCommand(`remote add ${name} ${url}`, context);
  if (action === 'remove' && name) return gitCommand(`remote remove ${name}`, context);
  if (action === 'set-url' && name && url) return gitCommand(`remote set-url ${name} ${url}`, context);
  if (action === 'get-url' && name) return gitCommand(`remote get-url ${name}`, context);
  return gitCommand('remote -v', context);
}

export async function gitTag(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const name = args['name'] as string | undefined;
  const message = args['message'] as string | undefined;
  const del = args['delete'] as boolean;
  if (del && name) return gitCommand(`tag -d ${name}`, context);
  if (name && message) return gitCommand(`tag -a ${name} -m "${message.replace(/"/g, '\\"')}"`, context);
  if (name) return gitCommand(`tag ${name}`, context);
  return gitCommand('tag -l', context);
}

export async function gitReset(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const target = (args['target'] as string) ?? 'HEAD';
  const mode = (args['mode'] as string) ?? 'mixed';
  const file = args['file'] as string | undefined;
  const validModes = ['soft', 'mixed', 'hard'];
  if (!validModes.includes(mode)) {
    return { success: false, output: `Invalid mode: ${mode}. Use soft, mixed, or hard.`, error: 'INVALID_MODE' };
  }
  let cmd = `reset --${mode} ${target}`;
  if (file) cmd += ` -- ${file}`;
  return gitCommand(cmd, context);
}

export async function gitCherryPick(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const commits = args['commits'] as string[] | string;
  const ids = Array.isArray(commits) ? commits.join(' ') : commits;
  return gitCommand(`cherry-pick ${ids}`, context);
}

export async function gitRebase(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const branch = args['branch'] as string;
  const interactive = args['interactive'] as boolean;
  const cmd = interactive ? `rebase -i ${branch}` : `rebase ${branch}`;
  return gitCommand(cmd, context);
}

export async function gitConfig(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const key = args['key'] as string | undefined;
  const value = args['value'] as string | undefined;
  const global = args['global'] as boolean;
  const scope = global ? '--global' : '';
  if (key && value !== undefined) return gitCommand(`config ${scope} ${key} "${value.replace(/"/g, '\\"')}"`, context);
  if (key) return gitCommand(`config ${scope} ${key}`, context);
  return gitCommand(`config ${scope} --list`, context);
}
