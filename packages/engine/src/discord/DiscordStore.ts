import { encryptJSON, decryptJSON } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';

interface DiscordStoredConfig {
  botToken: string;
  channelId?: string;
}

export class DiscordStore {
  private db: any;
  private dek: Buffer;

  constructor(db: any, dek: Buffer) {
    this.db = db;
    this.dek = dek;
  }

  save(config: DiscordStoredConfig): void {
    const encrypted = encryptJSON(config, this.dek);
    this.db.prepare(
      `INSERT OR REPLACE INTO bot_credentials (platform, config_enc, iv, tag, version, updated_at)
       VALUES (?, ?, ?, ?, '1.0', datetime('now'))`
    ).run('discord', encrypted.ciphertext, encrypted.iv, encrypted.tag);
  }

  load(): DiscordStoredConfig | null {
    const row = this.db.prepare(
      'SELECT config_enc, iv, tag FROM bot_credentials WHERE platform = ?'
    ).get('discord') as { config_enc: string; iv: string; tag: string } | undefined;

    if (!row) return null;

    const encrypted: EncryptedData = {
      ciphertext: row.config_enc,
      iv: row.iv,
      tag: row.tag,
    };
    return decryptJSON<DiscordStoredConfig>(encrypted, this.dek);
  }

  isConfigured(): boolean {
    const cfg = this.load();
    return cfg !== null && !!cfg.botToken;
  }

  clear(): void {
    this.db.prepare('DELETE FROM bot_credentials WHERE platform = ?').run('discord');
  }
}
