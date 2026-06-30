/**
 * Local cryptographic vault for PII and secrets.
 *
 * Stores AES-256-GCM encrypted values in PostgreSQL's `secure_vault` table.
 * The encryption key is provided by the caller. In the desktop app this key
 * should be derived from Electron's `safeStorage` (DPAPI/Keychain/libsecret);
 * in server/test environments a machine-derived fallback key is used.
 */
import type { Pool } from 'pg';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto';

export interface VaultEntry {
  id: string;
  token: string;
  encryptedValue: string;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
}

export type KeyProvider = () => Buffer | Promise<Buffer>;

const IV_LEN = 16;
const TAG_LEN = 16;
const ITERATIONS = 100_000;
const KEY_LEN = 32;

export class SecureVault {
  private keyPromise: Promise<Buffer> | null = null;

  constructor(
    private pool: Pool,
    private keyProvider?: KeyProvider,
  ) {}

  private async key(): Promise<Buffer> {
    if (!this.keyPromise) {
      this.keyPromise = Promise.resolve(this.keyProvider ? this.keyProvider() : this.fallbackKey());
    }
    return this.keyPromise;
  }

  private fallbackKey(): Buffer {
    const hostname = process.env['HOSTNAME'] || 'agentx-default';
    const material = `${hostname}:${process.cwd()}:agentx-vault`;
    return pbkdf2Sync(material, Buffer.alloc(16), ITERATIONS, KEY_LEN, 'sha256');
  }

  async store(token: string, value: string, kind = 'pii'): Promise<VaultEntry> {
    const key = await this.key();
    const encrypted = this.encrypt(value, key);
    const { rows } = await this.pool.query<VaultEntry>(
      `INSERT INTO secure_vault (token, encrypted_value, kind)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, kind = EXCLUDED.kind, updated_at = NOW()
       RETURNING id, token, encrypted_value AS "encryptedValue", kind, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [token, encrypted, kind],
    );
    if (!rows[0]) throw new Error('Failed to store vault entry');
    return rows[0];
  }

  async retrieve(token: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ encrypted_value: string }>(
      `SELECT encrypted_value FROM secure_vault WHERE token = $1`,
      [token],
    );
    if (!rows[0]) return null;
    try {
      const key = await this.key();
      return this.decrypt(rows[0].encrypted_value, key);
    } catch {
      return null;
    }
  }

  async delete(token: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM secure_vault WHERE token = $1`, [token]);
    return (rowCount ?? 0) > 0;
  }

  async purge(kind?: string): Promise<number> {
    const { rowCount } = kind
      ? await this.pool.query(`DELETE FROM secure_vault WHERE kind = $1`, [kind])
      : await this.pool.query(`DELETE FROM secure_vault`);
    return rowCount ?? 0;
  }

  async list(options: { kind?: string; limit?: number; offset?: number } = {}): Promise<Pick<VaultEntry, 'token' | 'kind' | 'createdAt' | 'updatedAt'>[]> {
    const { kind, limit = 100, offset = 0 } = options;
    const { rows } = kind
      ? await this.pool.query<{ token: string; kind: string; createdAt: Date; updatedAt: Date }>(
          `SELECT token, kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM secure_vault WHERE kind = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
          [kind, limit, offset],
        )
      : await this.pool.query<{ token: string; kind: string; createdAt: Date; updatedAt: Date }>(
          `SELECT token, kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM secure_vault ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        );
    return rows;
  }

  private encrypt(value: string, key: Buffer): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(value: string, key: Buffer): string {
    const buffer = Buffer.from(value, 'base64');
    if (buffer.length < IV_LEN + TAG_LEN) throw new Error('Invalid vault entry');
    const iv = buffer.subarray(0, IV_LEN);
    const tag = buffer.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const encrypted = buffer.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
  }
}
