import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../config/paths.js';

export interface SlackStoredConfig {
  botToken: string;
  appToken: string;
}

const CONFIG_FILE = 'slack.json';

/**
 * Persists Slack bot configuration to disk.
 * Stored in ~/.config/agentx/slack.json
 */
export class SlackStore {
  private configPath: string;

  constructor() {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    this.configPath = join(dir, CONFIG_FILE);
  }

  save(config: SlackStoredConfig): void {
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  load(): SlackStoredConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf-8')) as SlackStoredConfig;
    } catch {
      return null;
    }
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    if (existsSync(this.configPath)) {
      writeFileSync(this.configPath, '{}');
    }
  }
}
