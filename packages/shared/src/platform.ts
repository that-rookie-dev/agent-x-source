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

/** Default Agent-X workspace — user's Desktop folder. */
export function getDefaultWorkspaceDir(): string {
  return join(HOME, 'Desktop');
}
