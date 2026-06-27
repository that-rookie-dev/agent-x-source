import { encryptJSON, decryptJSON } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';

export interface SlackStoredConfig {
  botToken: string;
  appToken: string;
}

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export class SlackStore {
  private pool: PgPool;
  private dek: Buffer;

  constructor(pool: PgPool, dek: Buffer) {
    this.pool = pool;
    this.dek = dek;
  }

  async save(config: SlackStoredConfig): Promise<void> {
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
      ['slack', encrypted.ciphertext, encrypted.iv, encrypted.tag],
    );
  }

  async load(): Promise<SlackStoredConfig | null> {
    const res = await this.pool.query(
      'SELECT config_enc, iv, tag FROM bot_credentials WHERE platform = $1',
      ['slack'],
    );
    const row = res.rows[0] as { config_enc: string; iv: string; tag: string } | undefined;

    if (!row) return null;

    const encrypted: EncryptedData = {
      ciphertext: row.config_enc,
      iv: row.iv,
      tag: row.tag,
    };
    return decryptJSON<SlackStoredConfig>(encrypted, this.dek);
  }

  async isConfigured(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async clear(): Promise<void> {
    await this.pool.query('DELETE FROM bot_credentials WHERE platform = $1', ['slack']);
  }
}
