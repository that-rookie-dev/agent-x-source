import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const currentPlatform = platform();

export const IS_WINDOWS = currentPlatform === 'win32';
export const IS_MACOS = currentPlatform === 'darwin';
export const IS_LINUX = currentPlatform === 'linux';

const HOME = homedir();

export function getConfigDir(): string {
  return process.env['XDG_CONFIG_HOME']
    ? join(process.env['XDG_CONFIG_HOME'], 'agentx')
    : join(HOME, '.config', 'agentx');
}

export function getDataDir(): string {
  if (process.env['AGENTX_DATA_DIR']) {
    return process.env['AGENTX_DATA_DIR'];
  }
  return process.env['XDG_DATA_HOME']
    ? join(process.env['XDG_DATA_HOME'], 'agentx')
    : join(HOME, '.local', 'share', 'agentx');
}

export function getCacheDir(): string {
  return process.env['XDG_CACHE_HOME']
    ? join(process.env['XDG_CACHE_HOME'], 'agentx')
    : join(HOME, '.cache', 'agentx');
}

export function getHomeDir(): string {
  return HOME;
}

/**
 * Built-in Agent-X workspace — lives inside the app data directory so it
 * needs no user folder permission (e.g. ~/.local/share/agentx/workspace).
 */
export function getDefaultWorkspaceDir(): string {
  return join(getDataDir(), 'workspace');
}
