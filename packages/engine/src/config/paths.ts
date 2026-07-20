import { join } from 'node:path';
import {
  getConfigDir as _getConfigDir,
  getDataDir as _getDataDir,
  getCacheDir as _getCacheDir,
  getConfigPath as _getConfigPath,
  getDbPath as _getDbPath,
  getLogDir as _getLogDir,
} from '@agentx/shared';

// Re-export shared paths for backward compatibility
export const getConfigDir = _getConfigDir;
export const getDataDir = _getDataDir;
export const getCacheDir = _getCacheDir;
export const getConfigPath = _getConfigPath;
export const getDbPath = _getDbPath;
export const getLogDir = _getLogDir;

// Engine-specific paths (not in shared)
export function getCompactionFile(): string {
  return join(getCacheDir(), 'content.txt');
}

export function getPluginRegistryPath(): string {
  return join(getConfigDir(), 'plugin-registry.json');
}

export function getAcpConfigPath(): string {
  return join(getConfigDir(), 'acp.json');
}
