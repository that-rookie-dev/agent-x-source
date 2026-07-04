import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

let shellPathLoaded = false;

function pathSegments(pathValue?: string): string[] {
  if (!pathValue) return [];
  return pathValue.split(delimiter).map((segment) => segment.trim()).filter(Boolean);
}

function mergePathSegments(...groups: string[][]): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const segment of group) {
      const key = process.platform === 'win32' ? segment.toLowerCase() : segment;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(segment);
    }
  }
  return merged.join(delimiter);
}

function applyPath(pathValue: string): void {
  process.env.PATH = pathValue;
  if (platform() === 'win32') {
    process.env.Path = pathValue;
  }
}

function readNvmDefaultVersion(home: string): string | null {
  const aliasFile = join(home, '.nvm', 'alias', 'default');
  if (!existsSync(aliasFile)) return null;
  try {
    return readFileSync(aliasFile, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function unixLoginShellPath(): string[] {
  const shells = [
    process.env.SHELL,
    platform() === 'darwin' ? '/bin/zsh' : null,
    '/bin/bash',
    '/bin/sh',
  ].filter((shell): shell is string => Boolean(shell));

  for (const shell of shells) {
    for (const login of [true, false]) {
      try {
        const flag = login ? '-l ' : '';
        const shellPath = execSync(`${shell} ${flag}-c 'echo "$PATH"'`, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (shellPath) return pathSegments(shellPath);
      } catch {
        /* try next shell */
      }
    }
  }
  return [];
}

function unixNodeToolDirs(): string[] {
  const home = homedir();
  const dirs = [
    dirname(process.execPath),
    process.env.NVM_BIN,
    process.env.FNM_MULTISHELL_PATH,
    join(home, '.local', 'share', 'fnm', 'current', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin',
    '/snap/bin',
  ];

  const nvmVersion = readNvmDefaultVersion(home);
  if (nvmVersion) {
    dirs.push(join(home, '.nvm', 'versions', 'node', nvmVersion, 'bin'));
  }

  return dirs.filter((dir): dir is string => Boolean(dir));
}

function windowsNodeToolDirs(): string[] {
  const home = homedir();
  return [
    dirname(process.execPath),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'nodejs'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'nodejs'),
    process.env.APPDATA && join(process.env.APPDATA, 'npm'),
    process.env.NVM_HOME,
    process.env.FNM_MULTISHELL_PATH,
    join(home, '.fnm', 'current'),
    join(home, 'scoop', 'shims'),
    join(home, 'scoop', 'apps', 'nodejs', 'current', 'bin'),
  ].filter((dir): dir is string => Boolean(dir));
}

function ensureWindowsPath(): void {
  const segments: string[][] = [
    pathSegments(process.env.PATH),
    pathSegments(process.env.Path),
  ];

  try {
    const registryPath = execSync(
      'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\',\'Machine\')"',
      {
        encoding: 'utf-8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: platform() === 'win32' ? (process.env.COMSPEC ?? 'cmd.exe') : undefined,
      },
    ).trim();
    segments.push(pathSegments(registryPath));
  } catch {
    /* registry lookup optional */
  }

  segments.push(windowsNodeToolDirs());
  applyPath(mergePathSegments(...segments));
}

function ensureUnixPath(): void {
  const segments: string[][] = [
    pathSegments(process.env.PATH),
    unixLoginShellPath(),
    unixNodeToolDirs(),
  ];
  applyPath(mergePathSegments(...segments));
}

/** Hydrate PATH from the host OS (GUI apps often miss nvm/fnm/homebrew/scoop entries). */
export function ensureLoginShellPath(): void {
  if (shellPathLoaded) return;
  shellPathLoaded = true;
  if (platform() === 'win32') {
    ensureWindowsPath();
  } else {
    ensureUnixPath();
  }
}

function stdioCommandNames(command: string): string[] {
  if (platform() === 'win32') {
    return [command, `${command}.cmd`, `${command}.exe`];
  }
  return [command];
}

function lookupCommandInPath(command: string): string[] {
  try {
    const lookup = platform() === 'win32' ? `where ${command}` : `command -v ${command}`;
    const found = execSync(lookup, {
      encoding: 'utf-8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: platform() === 'win32' ? (process.env.COMSPEC ?? 'cmd.exe') : undefined,
    }).trim().split(/\r?\n/);
    return found.map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Resolve a bare stdio command (e.g. npx) to an absolute executable path when possible. */
export function resolveStdioCommand(command: string): string {
  if (!command) return command;
  if (command.includes('/') || (platform() === 'win32' && command.includes('\\'))) {
    return command;
  }

  ensureLoginShellPath();

  const candidates = [
    ...lookupCommandInPath(command),
    ...(platform() === 'win32' ? windowsNodeToolDirs() : unixNodeToolDirs()).flatMap((dir) =>
      stdioCommandNames(command).map((name) => join(dir, name)),
    ),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  return command;
}

export function buildStdioEnv(extra?: Record<string, string>): Record<string, string> {
  ensureLoginShellPath();
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  if (extra) Object.assign(merged, extra);
  if (platform() === 'win32' && merged.PATH) {
    merged.Path = merged.PATH;
  }
  return merged;
}

export function formatStdioSpawnError(error: unknown, command?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const mentionsNpx = command === 'npx' || /\bnpx\b/i.test(message);
  if (message.includes('ENOENT') && mentionsNpx) {
    const installHint = platform() === 'win32'
      ? 'Install Node.js 20+ from https://nodejs.org (or via winget/scoop), then restart Agent-X.'
      : 'Install Node.js 20+ from https://nodejs.org (or your package manager), then restart Agent-X.';
    return [
      'Node.js/npx was not found on PATH.',
      'Community MCP servers (including Booking.com) run locally via npx.',
      installHint,
    ].join(' ');
  }
  return message;
}

/** Test helper — reset cached PATH hydration between test cases. */
export function resetLoginShellPathForTests(): void {
  shellPathLoaded = false;
}
