import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../config/paths.js';

interface DiscordStoredConfig {
  botToken: string;
  channelId?: string;
}

const CONFIG_FILE = 'discord.json';

/**
 * Persists Discord bot configuration to disk.
 * Stored in ~/.config/agentx/discord.json
 */
export class DiscordStore {
  private configPath: string;

  constructor() {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    this.configPath = join(dir, CONFIG_FILE);
  }

  save(config: DiscordStoredConfig): void {
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  load(): DiscordStoredConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf-8')) as DiscordStoredConfig;
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    const cfg = this.load();
    return cfg !== null && !!cfg.botToken;
  }

  clear(): void {
    if (existsSync(this.configPath)) {
      writeFileSync(this.configPath, '{}');
    }
  }
}
