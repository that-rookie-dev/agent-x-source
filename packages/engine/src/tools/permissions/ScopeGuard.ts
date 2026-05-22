import { resolve, normalize } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';

export class ScopeGuard {
  private scopePath: string;

  constructor(scopePath: string) {
    this.scopePath = normalize(resolve(scopePath));
  }

  isWithinScope(targetPath: string): boolean {
    const normalizedTarget = normalize(resolve(targetPath));
    return normalizedTarget.startsWith(this.scopePath);
  }

  validatePath(targetPath: string): { valid: boolean; resolved: string; error?: string } {
    const resolved = normalize(resolve(targetPath));

    // Check symlink resolution
    if (existsSync(resolved)) {
      try {
        const realPath = realpathSync(resolved);
        if (!realPath.startsWith(this.scopePath)) {
          return {
            valid: false,
            resolved: realPath,
            error: `Symlink resolves outside scope: ${realPath}`,
          };
        }
      } catch {
        // If we can't resolve, just check the path itself
      }
    }

    if (!resolved.startsWith(this.scopePath)) {
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
