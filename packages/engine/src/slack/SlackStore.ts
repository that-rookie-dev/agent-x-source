import { getConfigDir } from '../config/paths.js';
import { SecureStore } from '../utils/SecureStore.js';

export interface SlackStoredConfig {
  botToken: string;
  appToken: string;
}

const CONFIG_FILE = 'slack.json';

/**
 * Persists Slack bot configuration to disk with encryption.
 * Stored in ~/.config/agentx/slack.json (encrypted)
 */
export class SlackStore {
  private secureStore: SecureStore<SlackStoredConfig>;

  constructor() {
    const dir = getConfigDir();
    this.secureStore = new SecureStore<SlackStoredConfig>(dir, CONFIG_FILE);
    
    // Migrate legacy plaintext configs to encrypted format
    this.secureStore.migrateLegacy();
  }

  save(config: SlackStoredConfig): void {
    this.secureStore.save(config);
  }

  load(): SlackStoredConfig | null {
    return this.secureStore.load();
  }

  isConfigured(): boolean {
    return this.secureStore.isConfigured();
  }

  clear(): void {
    this.secureStore.clear();
  }
}
