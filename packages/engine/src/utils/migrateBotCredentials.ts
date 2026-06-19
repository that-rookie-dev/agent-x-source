import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decrypt, encryptJSON } from '@agentx/shared';
import type { EncryptedData } from '@agentx/shared';

interface OldEncryptedStore {
  __encrypted: true;
  version: string;
  salt: string;
  iv: string;
  data: string;
}

function deriveOldMachineKey(configDir: string): Buffer {
  const hostname = process.env.HOSTNAME || 'agentx-default';
  const keyMaterial = `${hostname}:${configDir}:agentx-secure-store`;
  return Buffer.from(keyMaterial).subarray(0, 32);
}

function readOldFile(configDir: string, filename: string): unknown | null {
  const filePath = join(configDir, filename);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.__encrypted === true) {
      const store = parsed as OldEncryptedStore;
      const encryptedData = JSON.parse(store.data) as EncryptedData;
      const oldKey = deriveOldMachineKey(configDir);
      const plaintext = decrypt(encryptedData, oldKey);
      return JSON.parse(plaintext);
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface MigrationResult {
  platform: string;
  migrated: boolean;
  reason?: string;
}

export function migrateBotCredentials(
  db: any,
  dek: Buffer,
  configDir: string
): MigrationResult[] {
  const migrations: Array<{ platform: string; filename: string }> = [
    { platform: 'telegram', filename: 'telegram.json' },
    { platform: 'slack', filename: 'slack.json' },
    { platform: 'discord', filename: 'discord.json' },
  ];

  const results: MigrationResult[] = [];

  for (const { platform, filename } of migrations) {
    const existing = db.prepare(
      'SELECT 1 FROM bot_credentials WHERE platform = ?'
    ).get(platform);

    if (existing) {
      results.push({ platform, migrated: false, reason: 'already in database' });
      continue;
    }

    const config = readOldFile(configDir, filename);
    if (!config) {
      results.push({ platform, migrated: false, reason: 'no legacy file found' });
      continue;
    }

    try {
      const encrypted = encryptJSON(config, dek);
      db.prepare(
        `INSERT OR REPLACE INTO bot_credentials (platform, config_enc, iv, tag, version, updated_at)
         VALUES (?, ?, ?, ?, '1.0', datetime('now'))`
      ).run(platform, encrypted.ciphertext, encrypted.iv, encrypted.tag);
      results.push({ platform, migrated: true });
    } catch (err) {
      results.push({ platform, migrated: false, reason: String(err) });
    }
  }

  return results;
}
