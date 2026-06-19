import { encryptJSON, decryptJSON } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';

export interface SlackStoredConfig {
  botToken: string;
  appToken: string;
}

export class SlackStore {
  private db: any;
  private dek: Buffer;

  constructor(db: any, dek: Buffer) {
    this.db = db;
    this.dek = dek;
  }

  save(config: SlackStoredConfig): void {
    const encrypted = encryptJSON(config, this.dek);
    this.db.prepare(
      `INSERT OR REPLACE INTO bot_credentials (platform, config_enc, iv, tag, version, updated_at)
       VALUES (?, ?, ?, ?, '1.0', datetime('now'))`
    ).run('slack', encrypted.ciphertext, encrypted.iv, encrypted.tag);
  }

  load(): SlackStoredConfig | null {
    const row = this.db.prepare(
      'SELECT config_enc, iv, tag FROM bot_credentials WHERE platform = ?'
    ).get('slack') as { config_enc: string; iv: string; tag: string } | undefined;

    if (!row) return null;

    const encrypted: EncryptedData = {
      ciphertext: row.config_enc,
      iv: row.iv,
      tag: row.tag,
    };
    return decryptJSON<SlackStoredConfig>(encrypted, this.dek);
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    this.db.prepare('DELETE FROM bot_credentials WHERE platform = ?').run('slack');
  }
}
