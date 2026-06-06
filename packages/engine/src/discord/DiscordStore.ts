import { getConfigDir } from '../config/paths.js';
import { SecureStore } from '../utils/SecureStore.js';

interface DiscordStoredConfig {
  botToken: string;
  channelId?: string;
}

const CONFIG_FILE = 'discord.json';

/**
 * Persists Discord bot configuration to disk with encryption.
 * Stored in ~/.config/agentx/discord.json (encrypted)
 */
export class DiscordStore {
  private secureStore: SecureStore<DiscordStoredConfig>;

  constructor() {
    const dir = getConfigDir();
    this.secureStore = new SecureStore<DiscordStoredConfig>(dir, CONFIG_FILE);
    
    // Migrate legacy plaintext configs to encrypted format
    this.secureStore.migrateLegacy();
  }

  save(config: DiscordStoredConfig): void {
    this.secureStore.save(config);
  }

  load(): DiscordStoredConfig | null {
    return this.secureStore.load();
  }

  isConfigured(): boolean {
    const cfg = this.secureStore.load();
    return cfg !== null && !!cfg.botToken;
  }

  clear(): void {
    this.secureStore.clear();
  }
}
