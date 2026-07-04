import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IntegrationConnectionSecrets, IntegrationSecretRef } from '@agentx/shared';
import { decryptJSON, encryptJSON, getDataDir, getLogger, type EncryptedData } from '@agentx/shared';

const SERVICE_NAME = 'agent-x-integrations';
/** Single Keychain item holding all integration secrets when no DEK is available. */
const BULK_KEYCHAIN_ACCOUNT = 'secrets';
const logger = getLogger();

type KeyringEntry = {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): void;
};

async function loadKeyringEntry(account: string): Promise<KeyringEntry | null> {
  try {
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(SERVICE_NAME, account);
  } catch (error) {
    logger.warn('INTEGRATION_KEYRING_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export class IntegrationTokenVault {
  private readonly secretsDir: string;
  private readonly memoryCache = new Map<string, IntegrationConnectionSecrets>();
  private bulkKeychainLoaded = false;
  private bulkKeychainData: Record<string, IntegrationConnectionSecrets> = {};

  constructor(baseDir?: string) {
    this.secretsDir = join(baseDir ?? getDataDir(), 'integrations', 'secrets');
    if (!existsSync(this.secretsDir)) mkdirSync(this.secretsDir, { recursive: true });
  }

  async store(connectionId: string, secrets: IntegrationConnectionSecrets, dek: Buffer | null): Promise<IntegrationSecretRef> {
    this.memoryCache.set(connectionId, secrets);

    if (dek) {
      const encrypted = encryptJSON(secrets, dek);
      writeFileSync(this.dekFilePath(connectionId), JSON.stringify(encrypted), 'utf-8');
      await this.removeFromKeychain(connectionId);
      return { storage: 'dek_encrypted', connectionId };
    }

    await this.storeInBulkKeychain(connectionId, secrets);
    this.removeDekFile(connectionId);
    return { storage: 'keychain', connectionId };
  }

  async load(ref: IntegrationSecretRef, dek: Buffer | null): Promise<IntegrationConnectionSecrets | null> {
    const cached = this.memoryCache.get(ref.connectionId);
    if (cached) return cached;

    if (ref.storage === 'dek_encrypted') {
      const fromFile = this.loadFromDekFile(ref.connectionId, dek);
      if (fromFile) this.memoryCache.set(ref.connectionId, fromFile);
      return fromFile;
    }

    const fromKeychain = await this.loadFromKeychain(ref.connectionId);
    if (fromKeychain) this.memoryCache.set(ref.connectionId, fromKeychain);
    return fromKeychain;
  }

  /** Move legacy per-item Keychain secrets into DEK-encrypted files (one-time migration). */
  async migrateKeychainToDek(
    refs: Record<string, IntegrationSecretRef>,
    dek: Buffer | null,
  ): Promise<{ refs: Record<string, IntegrationSecretRef>; migrated: number }> {
    if (!dek) return { refs, migrated: 0 };

    const keychainIds = Object.entries(refs)
      .filter(([, ref]) => ref.storage === 'keychain')
      .map(([connectionId]) => connectionId);
    if (keychainIds.length === 0) return { refs, migrated: 0 };

    await this.preloadKeychainSecrets(keychainIds);

    const nextRefs = { ...refs };
    let migrated = 0;
    for (const connectionId of keychainIds) {
      const secrets = this.memoryCache.get(connectionId) ?? await this.loadFromKeychain(connectionId);
      if (!secrets) continue;
      nextRefs[connectionId] = await this.store(connectionId, secrets, dek);
      migrated += 1;
    }

    if (migrated > 0) {
      logger.info(
        'INTEGRATION_KEYCHAIN_MIGRATED',
        `Moved ${migrated} integration secret(s) from Keychain to encrypted storage.`,
      );
    }

    return { refs: nextRefs, migrated };
  }

  async delete(connectionId: string): Promise<void> {
    this.memoryCache.delete(connectionId);
    await this.removeFromKeychain(connectionId);
    this.removeDekFile(connectionId);
  }

  private loadFromDekFile(connectionId: string, dek: Buffer | null): IntegrationConnectionSecrets | null {
    const filePath = this.dekFilePath(connectionId);
    if (!existsSync(filePath) || !dek) return null;
    try {
      const encrypted = JSON.parse(readFileSync(filePath, 'utf-8')) as EncryptedData;
      return decryptJSON<IntegrationConnectionSecrets>(encrypted, dek);
    } catch (error) {
      logger.error('INTEGRATION_SECRET_DECRYPT_FAILED', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /** Load bulk + legacy Keychain entries once to minimize repeated macOS prompts. */
  private async preloadKeychainSecrets(connectionIds: string[]): Promise<void> {
    await this.ensureBulkKeychainLoaded();
    for (const connectionId of connectionIds) {
      if (this.memoryCache.has(connectionId) || this.bulkKeychainData[connectionId]) continue;
      const legacy = await this.loadLegacyKeychainEntry(connectionId);
      if (legacy) {
        this.bulkKeychainData[connectionId] = legacy;
        this.memoryCache.set(connectionId, legacy);
      }
    }
  }

  private async loadFromKeychain(connectionId: string): Promise<IntegrationConnectionSecrets | null> {
    await this.ensureBulkKeychainLoaded();
    const fromBulk = this.bulkKeychainData[connectionId];
    if (fromBulk) return fromBulk;
    return this.loadLegacyKeychainEntry(connectionId);
  }

  private async ensureBulkKeychainLoaded(): Promise<void> {
    if (this.bulkKeychainLoaded) return;
    this.bulkKeychainLoaded = true;

    const entry = await loadKeyringEntry(BULK_KEYCHAIN_ACCOUNT);
    if (!entry) return;

    const raw = entry.getPassword();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Record<string, IntegrationConnectionSecrets>;
      if (parsed && typeof parsed === 'object') {
        this.bulkKeychainData = parsed;
        for (const [connectionId, secrets] of Object.entries(parsed)) {
          this.memoryCache.set(connectionId, secrets);
        }
      }
    } catch {
      logger.warn('INTEGRATION_BULK_KEYCHAIN_PARSE_FAILED', 'Could not parse bulk Keychain payload');
    }
  }

  private async loadLegacyKeychainEntry(connectionId: string): Promise<IntegrationConnectionSecrets | null> {
    const entry = await loadKeyringEntry(connectionId);
    if (!entry) return null;
    const raw = entry.getPassword();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as IntegrationConnectionSecrets;
    } catch {
      return null;
    }
  }

  private async storeInBulkKeychain(
    connectionId: string,
    secrets: IntegrationConnectionSecrets,
  ): Promise<void> {
    await this.ensureBulkKeychainLoaded();
    this.bulkKeychainData[connectionId] = secrets;
    const entry = await loadKeyringEntry(BULK_KEYCHAIN_ACCOUNT);
    if (!entry) {
      throw new Error('Sign in to Agent-X to store integration credentials securely.');
    }
    entry.setPassword(JSON.stringify(this.bulkKeychainData));
    await this.removeLegacyKeychainEntry(connectionId);
  }

  private async removeFromKeychain(connectionId: string): Promise<void> {
    delete this.bulkKeychainData[connectionId];
    await this.removeLegacyKeychainEntry(connectionId);

    if (this.bulkKeychainLoaded) {
      const entry = await loadKeyringEntry(BULK_KEYCHAIN_ACCOUNT);
      if (!entry) return;
      if (Object.keys(this.bulkKeychainData).length === 0) {
        try {
          entry.deletePassword();
        } catch { /* already removed */ }
        return;
      }
      try {
        entry.setPassword(JSON.stringify(this.bulkKeychainData));
      } catch { /* best effort */ }
    }
  }

  private async removeLegacyKeychainEntry(connectionId: string): Promise<void> {
    const entry = await loadKeyringEntry(connectionId);
    if (!entry) return;
    try {
      entry.deletePassword();
    } catch { /* already removed */ }
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
