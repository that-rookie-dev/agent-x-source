import { getConfigDir } from '../config/paths.js';
import { SecureStore } from '../utils/SecureStore.js';

interface TelegramStoredConfig {
  botToken: string;
  allowedUserIds?: number[];
  lastUpdateId?: number;
}

const CONFIG_FILE = 'telegram.json';

/**
 * Persists Telegram bot configuration to disk with encryption.
 * Stored in ~/.config/agentx/telegram.json (encrypted)
 */
export class TelegramStore {
  private secureStore: SecureStore<TelegramStoredConfig>;

  constructor() {
    const dir = getConfigDir();
    this.secureStore = new SecureStore<TelegramStoredConfig>(dir, CONFIG_FILE);
    
    // Migrate legacy plaintext configs to encrypted format
    this.secureStore.migrateLegacy();
  }

  save(config: TelegramStoredConfig): void {
    this.secureStore.save(config);
  }

  load(): TelegramStoredConfig | null {
    return this.secureStore.load();
  }

  isConfigured(): boolean {
    return this.secureStore.isConfigured();
  }

  clear(): void {
    this.secureStore.clear();
  }
}
