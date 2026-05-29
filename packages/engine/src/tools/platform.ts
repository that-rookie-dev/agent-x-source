import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const currentPlatform = platform();

export const IS_WINDOWS = currentPlatform === 'win32';
export const IS_MACOS = currentPlatform === 'darwin';
export const IS_LINUX = currentPlatform === 'linux';

export function getShell(): string[] {
  if (IS_WINDOWS) {
    return ['cmd.exe', '/c'];
  }
  return ['sh', '-c'];
}

export function getShellCommand(command: string): { cmd: string; args: string[] } {
  if (IS_WINDOWS) {
    const shell = process.env['COMSPEC'] || 'cmd.exe';
    return { cmd: shell, args: ['/d', '/s', '/c', command] };
  }
  return { cmd: 'sh', args: ['-c', command] };
}

export function getWhichCommand(): string {
  return IS_WINDOWS ? 'where' : 'which';
}

export function getProcessListCommand(): string {
  if (IS_WINDOWS) {
    return 'tasklist /V /FO CSV /NH 2>nul';
  }
  return 'ps aux | head -20';
}

export function getDiskSpaceCommand(): string {
  if (IS_WINDOWS) {
    return 'wmic logicaldisk get size,freespace,caption 2>nul';
  }
  if (IS_MACOS) {
    return 'df -h / 2>/dev/null';
  }
  return 'df -h --total 2>/dev/null';
}

export function getPortListCommand(): string {
  if (IS_WINDOWS) {
    return 'netstat -ano | findstr LISTEN 2>nul | head -30';
  }
  if (IS_MACOS) {
    return 'lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | head -30';
  }
  return 'ss -tlnp 2>/dev/null | head -30';
}

export function getDirectorySizeCommand(target: string): string {
  if (IS_WINDOWS) {
    return `powershell -Command "Get-ChildItem -Path '${target}' -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select-Object @{Name='Size';Expression={[math]::Round($_.Sum / 1MB, 2)}} | Format-Table -AutoSize" 2>nul`;
  }
  return `du -sh "${target}" 2>/dev/null | sort -rh | head -20`;
}

export function getGrepCommand(pattern: string, includePattern: string): string {
  if (IS_WINDOWS) {
    const extMap: Record<string, string> = {
      ts: '*.ts', js: '*.js', json: '*.json', env: '*.env',
      yaml: '*.yaml', yml: '*.yml', toml: '*.toml',
    };
    const ext = extMap[includePattern.replace('*.', '')] || includePattern;
    return `findstr /s /n /r "${pattern}" "${ext}" 2>nul | findstr /v node_modules | findstr /v .git | findstr /v dist | head -20`;
  }
  return `grep -rn --include='${includePattern}' -i -E '${pattern}' . 2>/dev/null | grep -v node_modules | grep -v '.git/' | head -20`;
}

export function getFindCommand(pattern: string): string {
  if (IS_WINDOWS) {
    return `dir /s /b "${pattern}" 2>nul | findstr /v node_modules | findstr /v .git | head -100`;
  }
  return `find . -name "${pattern.replace(/"/g, '\\"')}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -100`;
}

export function getOcrCheckCommand(): string {
  return `${getWhichCommand()} tesseract 2>nul`;
}

export function checkCommandExists(command: string): boolean {
  try {
    execSync(`${getWhichCommand()} ${command}`, { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function execPlatformSafe(command: string, options?: { cwd?: string; timeout?: number; maxBuffer?: number }): string | null {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout: options?.timeout ?? 10000,
      maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
      cwd: options?.cwd,
    });
    return result;
  } catch {
    return null;
  }
}
