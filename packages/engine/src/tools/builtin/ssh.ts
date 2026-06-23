import { execSync } from 'node:child_process';
import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

const DANGEROUS_COMMANDS = [
  'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=', ':(){ :|:& };:', '> /dev/sda',
  'chmod -R 000 /', 'mv / /dev/null', 'wget --post-data',
];

function validateHost(host: string): void {
  if (!host || typeof host !== 'string') throw new Error('Host is required');
  if (host.includes(' ') || host.includes('|') || host.includes(';') || host.includes('`') || host.includes('$'))
    throw new Error('Invalid host: contains shell metacharacters');
  const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const hostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!ipv4.test(host) && !hostname.test(host))
    throw new Error('Invalid host format: must be a valid hostname or IP address');
}

function isDangerousCommand(command: string): boolean {
  const normalized = command.toLowerCase().trim();
  return DANGEROUS_COMMANDS.some(dc => normalized.startsWith(dc) || normalized.includes(dc));
}

export async function sshExec(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const host = String(args['host'] ?? '');
  const command = String(args['command'] ?? '');
  const user = String(args['user'] ?? 'root');
  let keyPath = args['keyPath'] ? String(args['keyPath']) : '';
  const port = Number(args['port']) || 22;
  const timeout = Math.min(Number(args['timeout']) || 30000, 120000);

  validateHost(host);

  if (isDangerousCommand(command)) {
    return { success: false, output: '', error: `Blocked dangerous command: ${command.slice(0, 100)}` };
  }

  if (!keyPath) {
    const home = homedir();
    const candidates = [`${home}/.ssh/id_ed25519`, `${home}/.ssh/id_rsa`, `${home}/.ssh/id_ecdsa`];
    for (const c of candidates) {
      if (existsSync(c)) { keyPath = c; break; }
    }
  }

  const sshCmd = `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p ${port} -i "${keyPath}" ${user}@${host} -- ${command}`;

  try {
    const stdout = execSync(sshCmd, { timeout, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return { success: true, output: stdout };
  } catch (err: unknown) {
    const error = err as { stderr?: string; stdout?: string; status?: number; message?: string };
    const stderr = error.stderr ?? '';
    const stdout = error.stdout ?? '';
    const combined = stdout + (stderr ? '\n' + stderr : '');
    return { success: false, output: combined, error: error.message ?? 'SSH execution failed' };
  }
}

export async function sshScp(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const host = String(args['host'] ?? '');
  const source = String(args['source'] ?? '');
  const dest = String(args['dest'] ?? '');
  const user = String(args['user'] ?? 'root');
  const keyPath = args['keyPath'] ? String(args['keyPath']) : `${homedir()}/.ssh/id_ed25519`;
  const direction = String(args['direction'] ?? 'upload');
  const port = Number(args['port']) || 22;
  const timeout = Math.min(Number(args['timeout']) || 60000, 300000);

  validateHost(host);

  const scpCmd = direction === 'upload'
    ? `scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -P ${port} -i "${keyPath}" "${source}" ${user}@${host}:"${dest}"`
    : `scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -P ${port} -i "${keyPath}" ${user}@${host}:"${source}" "${dest}"`;

  try {
    const stdout = execSync(scpCmd, { timeout, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    return { success: true, output: stdout };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string; status?: number };
    return { success: false, output: error.stderr ?? '', error: error.message ?? 'SCP transfer failed' };
  }
}

export async function sshKeyAdd(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const keyPath = String(args['keyPath'] ?? `${homedir()}/.ssh/id_ed25519`);
  const keyContent = args['keyContent'] ? String(args['keyContent']) : '';

  const resolvedPath = resolve(keyPath);

  try {
    if (keyContent) {
      writeFileSync(resolvedPath, keyContent + '\n', { mode: 0o600 });
    } else if (!existsSync(resolvedPath)) {
      return { success: false, output: '', error: `Key not found at ${resolvedPath} and no keyContent provided` };
    }

    chmodSync(resolvedPath, 0o600);
    execSync(`ssh-keygen -y -f "${resolvedPath}" > /dev/null 2>&1`, { timeout: 5000 });

    return { success: true, output: `SSH key ready at ${resolvedPath}` };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return { success: false, output: '', error: `SSH key setup failed: ${error.message}` };
  }
}
