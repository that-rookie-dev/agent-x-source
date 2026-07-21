import { join, resolve, normalize, sep } from 'node:path';
import { mkdirSync, existsSync, realpathSync } from 'node:fs';
import { getConfigDir, getDataDir, getCacheDir, getDefaultWorkspaceDir } from '../platform.js';

export { getConfigDir, getDataDir, getCacheDir, getDefaultWorkspaceDir } from '../platform.js';

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getDbPath(): string {
  return join(getDataDir(), 'db', 'agentx.db');
}

export function getLogDir(): string {
  return join(getDataDir(), 'logs');
}

/** Internal markdown documents; never leaves data dir except via explicit PDF export. */
export function getMarkdownDocumentsDir(): string {
  return join(getDataDir(), 'markdown');
}

/**
 * True when `targetPath` resolves inside `rootPath` (prefix-safe, symlink-aware).
 * Rejects null bytes and `../` escapes that leave the root.
 */
export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  if (!targetPath || !rootPath) return false;
  if (targetPath.includes('\0') || rootPath.includes('\0')) return false;

  const root = normalize(resolve(rootPath));
  const target = normalize(resolve(targetPath));
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  const lexicalOk = target === root || target.startsWith(rootPrefix);
  if (!lexicalOk) return false;

  // Symlink escape: real path must also stay inside the real root.
  try {
    const realRoot = existsSync(root) ? normalize(realpathSync(root)) : root;
    const realRootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (!existsSync(target)) return true;
    const realTarget = normalize(realpathSync(target));
    return realTarget === realRoot || realTarget.startsWith(realRootPrefix);
  } catch {
    return false;
  }
}

/** @deprecated Prefer isPathInsideRoot — kept for callers; now delegates to the safe helper. */
export function isWithinScope(targetPath: string, scopePath: string): boolean {
  return isPathInsideRoot(targetPath, scopePath);
}

/**
 * Internal application files directory — used for generated deliverables, attachments,
 * and temporary working files that should NEVER require user permission.
 * Resolves to a sub-directory of the Agent-X data dir (e.g. ~/.local/share/agentx/files).
 */
export function getAgentFilesDir(): string {
  const dir = resolve(join(getDataDir(), 'files'));
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  return dir;
}

/**
 * Ensure the built-in workspace directory exists and return its absolute path.
 * This is the default Agent-X Workspace until the user picks a custom folder.
 */
export function ensureBuiltinWorkspaceDir(): string {
  const dir = resolve(getDefaultWorkspaceDir());
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  return dir;
}

/**
 * Resolve the active Agent-X Workspace from config (custom path) or the built-in default.
 */
export function resolveWorkspacePath(workspacePath?: string | null): string {
  const custom = typeof workspacePath === 'string' ? workspacePath.trim() : '';
  if (custom) {
    const resolved = resolve(custom);
    try {
      mkdirSync(resolved, { recursive: true });
    } catch { /* ignore */ }
    return resolved;
  }
  return ensureBuiltinWorkspaceDir();
}

/** True when path is the built-in app-data workspace (not a user-chosen folder). */
export function isBuiltinWorkspacePath(path: string): boolean {
  if (!path) return false;
  return resolve(path) === resolve(getDefaultWorkspaceDir());
}

/**
 * Internal application temp directory — used for transient processing, caches, and
 * scratch files that should NEVER require user permission.
 * Resolves to a sub-directory of the Agent-X cache dir (e.g. ~/.cache/agentx/tmp).
 */
export function getAgentTempDir(): string {
  const dir = resolve(join(getCacheDir(), 'tmp'));
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  return dir;
}

/** True when `targetPath` is inside the Agent-X app files or temp dirs (internal, safe). */
export function isAgentInternalPath(targetPath: string): boolean {
  if (!targetPath) return false;
  const normalized = normalize(resolve(targetPath));
  const internal = [getAgentFilesDir(), getAgentTempDir(), getDataDir(), getCacheDir()];
  return internal.some((dir) => normalized === dir || normalized.startsWith(dir + sep) || normalized.startsWith(dir + '/'));
}
