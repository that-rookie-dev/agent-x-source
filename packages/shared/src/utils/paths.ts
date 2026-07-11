import { join } from 'node:path';
import { getConfigDir, getDataDir } from '../platform.js';

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

/** @deprecated Legacy storage path — used for reading older installs. */
export function getLegacyMarkdownDocumentsDir(): string {
  return join(getDataDir(), 'canvases');
}

export function isWithinScope(targetPath: string, scopePath: string): boolean {
  const normalizedTarget = join(targetPath);
  const normalizedScope = join(scopePath);
  return normalizedTarget.startsWith(normalizedScope);
}
