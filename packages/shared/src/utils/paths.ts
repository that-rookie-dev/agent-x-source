import { join, resolve, normalize } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getConfigDir, getDataDir, getCacheDir } from '../platform.js';

export { getConfigDir, getDataDir, getCacheDir } from '../platform.js';

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getDbPath(): string {
  return join(getDataDir(), 'db', 'agentx.db');
}

export function getSecretSauceDir(): string {
  return join(getDataDir(), 'secret-sauce');
}

export function getLogDir(): string {
  return join(getDataDir(), 'logs');
}

/** Internal markdown documents; never leaves data dir except via explicit PDF export. */
export function getMarkdownDocumentsDir(): string {
  return join(getDataDir(), 'markdown');
}

export function isWithinScope(targetPath: string, scopePath: string): boolean {
  const normalizedTarget = join(targetPath);
  const normalizedScope = join(scopePath);
  return normalizedTarget.startsWith(normalizedScope);
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
  return internal.some((dir) => normalized === dir || normalized.startsWith(dir + '/'));
}
