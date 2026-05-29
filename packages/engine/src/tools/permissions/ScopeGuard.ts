import { resolve, normalize, sep } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { platform } from 'node:os';

export class ScopeGuard {
  private scopePath: string;
  private scopePathReal: string;
  private dangerousPaths: string[];

  constructor(scopePath: string) {
    this.scopePath = normalize(resolve(scopePath));
    this.scopePathReal = resolveRealPath(this.scopePath);
    this.dangerousPaths = getDangerousPaths();
  }

  isWithinScope(targetPath: string): boolean {
    const normalizedTarget = normalize(resolve(targetPath));
    return normalizedTarget.startsWith(this.scopePath) || normalizedTarget.startsWith(this.scopePathReal);
  }

  validatePath(targetPath: string): { valid: boolean; resolved: string; error?: string } {
    const resolved = normalize(resolve(targetPath));

    // Resolve symlinks and check if the real target is within scope
    if (existsSync(resolved)) {
      try {
        const realPath = normalize(realpathSync(resolved));
        const rawWithinScope = resolved.startsWith(this.scopePath) || resolved.startsWith(this.scopePathReal);
        const realWithinScope = realPath.startsWith(this.scopePathReal) || realPath.startsWith(this.scopePath);

        // Symlink within scope that targets outside scope → reject
        if (rawWithinScope && !realWithinScope) {
          return {
            valid: false,
            resolved: realPath,
            error: `Symlink resolves outside scope: ${realPath}`,
          };
        }

        // Either raw or real path is within scope → allow
        if (rawWithinScope || realWithinScope) {
          return { valid: true, resolved: realWithinScope ? realPath : resolved };
        }
      } catch {
        // If we can't resolve, just check the path itself
      }
    }

    // Check for dangerous system paths (only if outside scope)
    if (!resolved.startsWith(this.scopePath) && !resolved.startsWith(this.scopePathReal)) {
      for (const dangerousPath of this.dangerousPaths) {
        if (resolved === dangerousPath || resolved.startsWith(dangerousPath + sep)) {
          return {
            valid: false,
            resolved,
            error: `Access to system path ${dangerousPath} is not allowed`,
          };
        }
      }

      return {
        valid: false,
        resolved,
        error: `Path is outside scope: ${resolved} (scope: ${this.scopePath})`,
      };
    }

    return { valid: true, resolved };
  }

  getScopePath(): string {
    return this.scopePath;
  }
}

function resolveRealPath(p: string): string {
  try {
    return normalize(realpathSync(p));
  } catch {
    return p;
  }
}

function getDangerousPaths(): string[] {
  const currentPlatform = platform();
  const paths: string[] = [];

  if (currentPlatform === 'win32') {
    paths.push(...getWindowsDangerousPaths());
  } else {
    paths.push(...getUnixDangerousPaths(currentPlatform === 'darwin'));
  }

  return paths.map((p) => normalize(p));
}

function getWindowsDangerousPaths(): string[] {
  const paths: string[] = [];

  const windir = process.env['WINDIR'] || 'C:\\Windows';
  const programData = process.env['PROGRAMDATA'] || 'C:\\ProgramData';
  const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const systemRoot = process.env['SYSTEMROOT'] || windir;
  const allUsersProfile = process.env['ALLUSERSPROFILE'] || programData;
  const publicDir = process.env['PUBLIC'] || 'C:\\Users\\Public';

  paths.push(windir, programData, programFiles, programFilesX86, systemRoot, allUsersProfile, publicDir);
  paths.push('C:\\$Recycle.Bin', 'C:\\System Volume Information', 'C:\\Recovery');

  // Block all drive roots
  for (let i = 65; i <= 90; i++) {
    const drive = String.fromCharCode(i);
    paths.push(`${drive}:\\`);
  }

  return paths;
}

function getUnixDangerousPaths(isMacOS: boolean): string[] {
  const paths: string[] = [
    '/etc',
    '/root',
    '/var',
    '/proc',
    '/sys',
    '/dev',
    '/boot',
    '/lib',
    '/lib64',
    '/bin',
    '/sbin',
    '/usr',
    '/opt',
    '/srv',
  ];

  // macOS-specific system directories
  if (isMacOS) {
    paths.push('/Volumes', '/Network', '/System', '/Users');
    // macOS symlinks /var -> /private/var, /etc -> /private/etc, /tmp -> /private/tmp
    // Block access via the real path to prevent bypass
    for (const p of ['/var', '/etc', '/tmp']) {
      paths.push('/private' + p);
    }
  }

  return paths;
}
