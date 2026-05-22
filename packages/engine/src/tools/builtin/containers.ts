import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function containerList(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return dockerCommand('ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"', context);
}

export async function containerLogs(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const name = args['name'] as string;
  const tail = (args['tail'] as number) ?? 50;
  return dockerCommand(`logs --tail ${tail} ${name}`, context);
}

export async function containerStart(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const name = args['name'] as string;
  return dockerCommand(`start ${name}`, context);
}

export async function containerStop(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const name = args['name'] as string;
  return dockerCommand(`stop ${name}`, context);
}

export async function containerExec(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const name = args['name'] as string;
  const command = args['command'] as string;
  return dockerCommand(`exec ${name} ${command}`, context);
}

export async function containerRun(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const image = args['image'] as string;
  const name = args['name'] as string | undefined;
  const ports = args['ports'] as string | undefined;
  const envVars = args['env'] as Record<string, string> | undefined;
  const detach = args['detach'] !== false;

  let cmd = `run${detach ? ' -d' : ''}`;
  if (name) cmd += ` --name ${name}`;
  if (ports) cmd += ` -p ${ports}`;
  if (envVars) {
    for (const [k, v] of Object.entries(envVars)) {
      cmd += ` -e ${k}=${v}`;
    }
  }
  cmd += ` ${image}`;

  return dockerCommand(cmd, context);
}

export async function containerCompose(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const action = args['action'] as string; // up, down, ps, logs, restart
  const services = args['services'] as string | undefined;
  const cwd = resolve(context.scopePath);

  let cmd = `docker compose ${action}`;
  if (action === 'up') cmd += ' -d';
  if (services) cmd += ` ${services}`;

  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    return { success: false, output: err.stderr ?? err.message, error: 'COMPOSE_ERROR' };
  }
}

export async function containerImages(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  return dockerCommand('images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"', context);
}

function dockerCommand(cmd: string, context: ToolExecutionContext): ToolResult {
  const cwd = resolve(context.scopePath);
  try {
    const output = execSync(`docker ${cmd}`, { cwd, encoding: 'utf-8', timeout: 30000 });
    return { success: true, output: output.trim() || '(no output)' };
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'DOCKER_ERROR' };
  }
}
