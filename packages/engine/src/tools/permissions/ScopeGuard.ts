import { resolve, normalize, sep } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { platform } from 'node:os';
import { isAgentInternalPath } from '@agentx/shared';
import { GitManager } from '../../session/GitManager.js';
import { execSync } from 'node:child_process';

export class ScopeGuard {
  private scopePath: string;
  private scopePathReal: string;
  private dangerousPaths: string[];
  private gitManager: GitManager | null = null;
  private gitAware: boolean = false;
  private gitRoot: string | null = null;
  private gitBranch: string | null = null;
  private allowOutsideGit: boolean = false;

  constructor(scopePath: string, gitAware = false) {
    this.scopePath = normalize(resolve(scopePath));
    this.scopePathReal = resolveRealPath(this.scopePath);
    this.dangerousPaths = getDangerousPaths();
    this.gitAware = gitAware;
    if (gitAware) {
      this.gitManager = new GitManager({ scopePath: this.scopePath });
      this.gitRoot = this.resolveGitRoot();
      this.gitBranch = this.resolveGitBranch();
    }
  }

  private resolveGitRoot(): string | null {
    try {
      const output = execSync('git rev-parse --show-toplevel 2>/dev/null', { cwd: this.scopePath, encoding: 'utf-8', timeout: 5000 });
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  private resolveGitBranch(): string | null {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd: this.scopePath, encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
      return null;
    }
  }

  isInsideGitRepo(): boolean {
    return this.gitRoot !== null;
  }

  isWithinScope(targetPath: string): boolean {
    const normalizedTarget = normalize(resolve(this.scopePath, targetPath));
    const withinScope = normalizedTarget.startsWith(this.scopePath) || normalizedTarget.startsWith(this.scopePathReal);
    if (!withinScope) return false;
    if (this.gitAware && this.gitManager?.isInsideRepo()) {
      return this.gitManager.isPathInsideRepo(normalizedTarget);
    }
    return true;
  }

  validatePath(targetPath: string): { valid: boolean; resolved: string; error?: string } {
    // Reject null bytes — common bypass technique
    if (targetPath.includes('\x00')) {
      return { valid: false, resolved: targetPath, error: 'Path contains null bytes' };
    }

    // Agent-internal paths (data/tmp) are always allowed — these are app-scoped scratch
    // and deliverable directories, not user workspace, so they never require scope checks.
    let resolved = normalize(resolve(this.scopePath, targetPath));
    if (isAgentInternalPath(targetPath) || isAgentInternalPath(resolved)) {
      return { valid: true, resolved };
    }

    // Strip trailing separator to prevent comparison bypass
    while (resolved.endsWith(sep) && resolved.length > 1) {
      resolved = resolved.slice(0, -1);
    }

    // Reject path traversal beyond scope via canonical check before realpath
    // This catches '../' patterns that normalize would collapse
    if (!resolved.startsWith(this.scopePath) && !resolved.startsWith(this.scopePathReal)) {
      // Check if the raw target path contains traversal patterns
      if (targetPath.includes('..')) {
        return {
          valid: false,
          resolved,
          error: `Path traversal detected: ${targetPath}`,
        };
      }
    }

    // Git-aware scope: reject paths outside repo root
    if (this.gitAware && this.gitManager?.isInsideRepo()) {
      if (!this.gitManager.isPathInsideRepo(resolved)) {
        return {
          valid: false,
          resolved,
          error: `Path is outside the Git repository root: ${resolved}`,
        };
      }
    }

    if (!this.allowOutsideGit && this.isInsideGitRepo() && this.gitRoot) {
      if (!resolved.startsWith(this.gitRoot)) {
        return {
          valid: false,
          resolved,
          error: `Path is outside the Git repository root: ${resolved}`,
        };
      }
    }

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

  getGitManager(): GitManager | null {
    return this.gitManager;
  }

  getGitInfo(): { root: string | null; branch: string | null; dirty: boolean } {
    let dirty = false;
    if (this.gitRoot) {
      try {
        const status = execSync('git status --porcelain', { cwd: this.gitRoot, encoding: 'utf-8', timeout: 5000 });
        dirty = status.trim().length > 0;
      } catch {
        dirty = false;
      }
    }
    return { root: this.gitRoot, branch: this.gitBranch, dirty };
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

  return paths.map((p) => {
    const n = normalize(p);
    // Strip trailing separator so drive roots like D:\ and D: compare equal.
    return n.endsWith(sep) && n.length > 1 ? n.slice(0, -1) : n;
  });
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
