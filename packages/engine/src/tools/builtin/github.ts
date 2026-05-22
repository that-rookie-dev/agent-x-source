import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function ghIssueList(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const state = (args['state'] as string) ?? 'open';
  const limit = (args['limit'] as number) ?? 10;
  return ghCommand(`issue list --state ${state} --limit ${limit}`, context);
}

export async function ghIssueCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const title = args['title'] as string;
  const body = args['body'] as string | undefined;
  let cmd = `issue create --title "${title.replace(/"/g, '\\"')}"`;
  if (body) cmd += ` --body "${body.replace(/"/g, '\\"')}"`;
  return ghCommand(cmd, context);
}

export async function ghPrList(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const state = (args['state'] as string) ?? 'open';
  const limit = (args['limit'] as number) ?? 10;
  return ghCommand(`pr list --state ${state} --limit ${limit}`, context);
}

export async function ghPrCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const title = args['title'] as string;
  const body = args['body'] as string | undefined;
  const base = args['base'] as string | undefined;
  let cmd = `pr create --title "${title.replace(/"/g, '\\"')}"`;
  if (body) cmd += ` --body "${body.replace(/"/g, '\\"')}"`;
  if (base) cmd += ` --base ${base}`;
  return ghCommand(cmd, context);
}

export async function ghPrView(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const number = args['number'] as number | string;
  return ghCommand(`pr view ${number}`, context);
}

export async function ghRepoView(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return ghCommand('repo view', context);
}

export async function ghWorkflowList(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return ghCommand('run list --limit 10', context);
}

export async function ghRelease(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const action = (args['action'] as string) ?? 'list';
  if (action === 'list') return ghCommand('release list --limit 5', context);
  return { success: false, output: 'Use action: list', error: 'INVALID_ACTION' };
}

function ghCommand(cmd: string, context: ToolExecutionContext): ToolResult {
  const cwd = resolve(context.scopePath);
  try {
    const output = execSync(`gh ${cmd}`, { cwd, encoding: 'utf-8', timeout: 15000 });
    return { success: true, output: output.trim() || '(no output)' };
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    return { success: false, output: err.stderr ?? err.message, error: 'GH_ERROR' };
  }
}
