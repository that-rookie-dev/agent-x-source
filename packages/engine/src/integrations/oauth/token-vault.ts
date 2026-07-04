import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntegrationConnectionSecrets, IntegrationSecretRef } from '@agentx/shared';
import { decryptJSON, encryptJSON, getDataDir, getLogger, type EncryptedData } from '@agentx/shared';

const SERVICE_NAME = 'agent-x-integrations';
const logger = getLogger();

type KeyringEntry = {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): void;
};

async function loadKeyringEntry(connectionId: string): Promise<KeyringEntry | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(SERVICE_NAME, connectionId);
  } catch (error) {
    logger.warn('INTEGRATION_KEYRING_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export class IntegrationTokenVault {
  private readonly secretsDir: string;

  constructor(baseDir?: string) {
    this.secretsDir = join(baseDir ?? getDataDir(), 'integrations', 'secrets');
    if (!existsSync(this.secretsDir)) mkdirSync(this.secretsDir, { recursive: true });
  }

  async store(connectionId: string, secrets: IntegrationConnectionSecrets, dek: Buffer | null): Promise<IntegrationSecretRef> {
    const payload = JSON.stringify(secrets);
    const entry = await loadKeyringEntry(connectionId);
    if (entry) {
      entry.setPassword(payload);
      this.removeDekFile(connectionId);
      return { storage: 'keychain', connectionId };
    }
    if (!dek) {
      throw new Error('Sign in to Agent-X to store integration credentials securely.');
    }
    const encrypted = encryptJSON(secrets, dek);
    writeFileSync(this.dekFilePath(connectionId), JSON.stringify(encrypted), 'utf-8');
    return { storage: 'dek_encrypted', connectionId };
  }

  async load(ref: IntegrationSecretRef, dek: Buffer | null): Promise<IntegrationConnectionSecrets | null> {
    if (ref.storage === 'keychain') {
      const entry = await loadKeyringEntry(ref.connectionId);
      if (!entry) return null;
      const raw = entry.getPassword();
      if (!raw) return null;
      try {
        return JSON.parse(raw) as IntegrationConnectionSecrets;
      } catch {
        return null;
      }
    }
    const filePath = this.dekFilePath(ref.connectionId);
    if (!existsSync(filePath) || !dek) return null;
    try {
      const encrypted = JSON.parse(readFileSync(filePath, 'utf-8')) as EncryptedData;
      return decryptJSON<IntegrationConnectionSecrets>(encrypted, dek);
    } catch (error) {
      logger.error('INTEGRATION_SECRET_DECRYPT_FAILED', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async delete(connectionId: string): Promise<void> {
    const entry = await loadKeyringEntry(connectionId);
    if (entry) {
      try {
        entry.deletePassword();
      } catch { /* already removed */ }
    }
    this.removeDekFile(connectionId);
  }

  private dekFilePath(connectionId: string): string {
    return join(this.secretsDir, `${connectionId}.enc.json`);
  }

  private removeDekFile(connectionId: string): void {
    const filePath = this.dekFilePath(connectionId);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch { /* best effort */ }
    }
  }
}
