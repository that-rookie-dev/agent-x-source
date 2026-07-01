import { encryptJSON, decryptJSON } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';

interface DiscordStoredConfig {
  botToken: string;
  channelId?: string;
}

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export class DiscordStore {
  private pool: PgPool;
  private dek: Buffer;

  constructor(pool: PgPool, dek: Buffer) {
    this.pool = pool;
    this.dek = dek;
  }

  async save(config: DiscordStoredConfig): Promise<void> {
    const encrypted = encryptJSON(config, this.dek);
    await this.pool.query(
      `INSERT INTO bot_credentials (platform, config_enc, iv, tag, version, updated_at)
       VALUES ($1, $2, $3, $4, '1.0', NOW())
       ON CONFLICT (platform) DO UPDATE SET
         config_enc = EXCLUDED.config_enc,
         iv = EXCLUDED.iv,
         tag = EXCLUDED.tag,
         version = EXCLUDED.version,
         updated_at = NOW()`,
      ['discord', encrypted.ciphertext, encrypted.iv, encrypted.tag],
    );
  }

  async load(): Promise<DiscordStoredConfig | null> {
    const res = await this.pool.query(
      'SELECT config_enc, iv, tag FROM bot_credentials WHERE platform = $1',
      ['discord'],
    );
    const row = res.rows[0] as { config_enc: string; iv: string; tag: string } | undefined;

    if (!row) return null;

    const encrypted: EncryptedData = {
      ciphertext: row.config_enc,
      iv: row.iv,
      tag: row.tag,
    };
    return decryptJSON<DiscordStoredConfig>(encrypted, this.dek);
  }

  async isConfigured(): Promise<boolean> {
    const cfg = await this.load();
    return cfg !== null && !!cfg.botToken;
  }

  async clear(): Promise<void> {
    await this.pool.query('DELETE FROM bot_credentials WHERE platform = $1', ['discord']);
  }
}
