import { execSync } from 'node:child_process';
import { homedir, platform, arch, cpus, totalmem, freemem, hostname, uptime } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import {
  IS_WINDOWS,
  getDiskSpaceCommand,
  getPortListCommand,
  getDirectorySizeCommand,
  getGrepCommand,
} from '../platform.js';

const currentPlatform = platform();

export async function systemInfo(_args: Record<string, unknown>): Promise<ToolResult> {
  const info = {
    platform: currentPlatform,
    arch: arch(),
    hostname: hostname(),
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    totalMemory: `${(totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
    freeMemory: `${(freemem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
    uptime: `${(uptime() / 3600).toFixed(1)} hours`,
    nodeVersion: process.version,
    home: homedir(),
  };

  const output = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('\n');
  return { success: true, output };
}

export async function systemDiskSpace(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  try {
    const cmd = getDiskSpaceCommand();
    const output = execSync(cmd, {
      cwd: context.scopePath,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'DISK_ERROR' };
  }
}

export async function systemEnv(args: Record<string, unknown>): Promise<ToolResult> {
  const filter = args['filter'] as string | undefined;

  const env = Object.entries(process.env)
    .filter(([k]) => !k.includes('SECRET') && !k.includes('KEY') && !k.includes('TOKEN') && !k.includes('PASSWORD'))
    .filter(([k]) => !filter || k.toLowerCase().includes(filter.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 50)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  return { success: true, output: env || '(no matching env vars)' };
}

export async function systemWhich(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args['command'] as string;
  try {
    const whichCmd = IS_WINDOWS ? 'where' : 'which';
    const output = execSync(`${whichCmd} ${command}`, { encoding: 'utf-8', timeout: 5000 });
    return { success: true, output: output.trim() };
  } catch {
    return { success: false, output: `"${command}" not found in PATH`, error: 'NOT_FOUND' };
  }
}

export async function systemPorts(_args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const cmd = getPortListCommand();
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
    return { success: true, output: output.trim() || 'No listening ports' };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'PORTS_ERROR' };
  }
}

export async function systemTreeSize(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = args['path'] as string | undefined;
  const target = resolve(context.scopePath, path ?? '.');

  try {
    const cmd = getDirectorySizeCommand(target);
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SIZE_ERROR' };
  }
}

export async function securityAudit(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  const target = (args['target'] as string) ?? 'npm';

  try {
    let cmd: string;
    if (target === 'npm' && existsSync(join(cwd, 'package.json'))) {
      cmd = IS_WINDOWS
        ? 'npm audit --json 2>nul'
        : 'npm audit --json 2>/dev/null | head -100';
    } else {
      return { success: true, output: 'No supported audit target found' };
    }

    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30000 });
    try {
      const audit = JSON.parse(output) as { metadata?: { vulnerabilities?: Record<string, number> } };
      const vulns = audit.metadata?.vulnerabilities;
      if (!vulns) return { success: true, output: 'No vulnerabilities found' };
      const summary = Object.entries(vulns)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return { success: true, output: summary || 'No vulnerabilities found' };
    } catch {
      return { success: true, output: output.trim().slice(0, 2000) };
    }
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'AUDIT_ERROR' };
  }
}

export async function securitySecrets(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const cwd = resolve(context.scopePath);
  void args;

  try {
    const patterns = [
      'api[_-]?key',
      'secret[_-]?key',
      'password',
      'token',
      'private[_-]?key',
    ];
    const grepPattern = patterns.join('|');
    const cmd = getGrepCommand(grepPattern, '*.{ts,js,json,env,yaml,yml,toml}');
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 });
    if (!output.trim()) {
      return { success: true, output: 'No potential secrets found' };
    }
    return { success: true, output: `Potential secrets found:\n${output.trim()}`, metadata: { warning: 'Review these files' } };
  } catch {
    return { success: true, output: 'No potential secrets found' };
  }
}

export async function fileChecksum(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);
  const algorithm = (args['algorithm'] as string) ?? 'sha256';

  if (!existsSync(file)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  const content = readFileSync(file);
  const { createHash } = await import('node:crypto');
  const hash = createHash(algorithm).update(content).digest('hex');
  return { success: true, output: `${algorithm}: ${hash}` };
}
