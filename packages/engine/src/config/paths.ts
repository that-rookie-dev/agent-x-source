import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

export function getConfigDir(): string {
  return process.env['XDG_CONFIG_HOME']
    ? join(process.env['XDG_CONFIG_HOME'], 'agentx')
    : join(HOME, '.config', 'agentx');
}

export function getDataDir(): string {
  return process.env['XDG_DATA_HOME']
    ? join(process.env['XDG_DATA_HOME'], 'agentx')
    : join(HOME, '.local', 'share', 'agentx');
}

export function getCacheDir(): string {
  return process.env['XDG_CACHE_HOME']
    ? join(process.env['XDG_CACHE_HOME'], 'agentx')
    : join(HOME, '.cache', 'agentx');
}

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

export function getCompactionFile(): string {
  return join(getCacheDir(), 'content.txt');
}
