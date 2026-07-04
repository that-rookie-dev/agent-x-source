import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IntegrationConnection, IntegrationConnectionSecrets, IntegrationSecretRef } from '@agentx/shared';
import { getDataDir, getLogger } from '@agentx/shared';
import { getProviderById } from './catalog/loader.js';
import { IntegrationTokenVault } from './oauth/token-vault.js';

const logger = getLogger();

interface PersistedStore {
  connections: IntegrationConnection[];
  secretRefs: Record<string, IntegrationSecretRef>;
  /** @deprecated Legacy inline secrets — migrated to vault on next sign-in. */
  secrets?: Record<string, IntegrationConnectionSecrets>;
}

export class IntegrationConnectionStore {
  private readonly dir: string;
  private readonly filePath: string;
  private readonly vault: IntegrationTokenVault;
  private data: PersistedStore = { connections: [], secretRefs: {} };
  private legacySecrets: Record<string, IntegrationConnectionSecrets> = {};

  constructor(baseDir?: string) {
    this.dir = join(baseDir ?? getDataDir(), 'integrations');
    this.filePath = join(this.dir, 'connections.json');
    this.vault = new IntegrationTokenVault(baseDir);
    this.load();
  }

  listConnections(): IntegrationConnection[] {
    return [...this.data.connections];
  }

  getConnection(id: string): IntegrationConnection | undefined {
    return this.data.connections.find((connection) => connection.id === id);
  }

  async getSecrets(connectionId: string, dek?: Buffer | null): Promise<IntegrationConnectionSecrets | null> {
    const ref = this.data.secretRefs[connectionId];
    if (!ref) return null;
    return this.vault.load(ref, dek ?? null);
  }

  async upsertConnection(
    input: Omit<IntegrationConnection, 'id' | 'connectedAt' | 'status'> & { id?: string },
    secrets?: IntegrationConnectionSecrets,
    dek?: Buffer | null,
  ): Promise<IntegrationConnection> {
    const provider = getProviderById(input.providerId);
    const now = new Date().toISOString();
    const existing = input.id ? this.getConnection(input.id) : undefined;
    const connection: IntegrationConnection = {
      id: existing?.id ?? input.id ?? randomUUID(),
      providerId: input.providerId,
      displayName: input.displayName || provider?.name || input.providerId,
      status: 'disconnected',
      authMode: input.authMode,
      connectedAt: existing?.connectedAt ?? now,
      lastSyncAt: existing?.lastSyncAt,
      error: undefined,
      accountLabel: input.accountLabel,
      toolCount: existing?.toolCount ?? 0,
      enabled: input.enabled ?? true,
      stdio: input.stdio,
      remote: input.remote,
    };

    if (existing) {
      this.data.connections = this.data.connections.map((item) => (item.id === connection.id ? connection : item));
    } else {
      this.data.connections.push(connection);
    }

    if (secrets) {
      this.data.secretRefs[connection.id] = await this.vault.store(connection.id, secrets, dek ?? null);
    }

    this.save();
    return connection;
  }

  updateConnection(id: string, patch: Partial<IntegrationConnection>): IntegrationConnection | undefined {
    const current = this.getConnection(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.data.connections = this.data.connections.map((item) => (item.id === id ? next : item));
    this.save();
    return next;
  }

  async removeConnection(id: string): Promise<boolean> {
    const before = this.data.connections.length;
    this.data.connections = this.data.connections.filter((item) => item.id !== id);
    delete this.data.secretRefs[id];
    delete this.legacySecrets[id];
    await this.vault.delete(id);
    if (this.data.connections.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Move legacy plaintext secrets from connections.json into the secure vault. */
  async migrateLegacySecrets(dek: Buffer | null): Promise<number> {
    const entries = Object.entries(this.legacySecrets);
    if (entries.length === 0) return 0;

    let migrated = 0;
    for (const [connectionId, secrets] of entries) {
      if (!this.getConnection(connectionId)) {
        delete this.legacySecrets[connectionId];
        continue;
      }
      if (this.data.secretRefs[connectionId]) {
        delete this.legacySecrets[connectionId];
        continue;
      }
      try {
        this.data.secretRefs[connectionId] = await this.vault.store(connectionId, secrets, dek);
        delete this.legacySecrets[connectionId];
        migrated += 1;
      } catch (error) {
        logger.warn(
          'INTEGRATION_LEGACY_MIGRATE_FAILED',
          `${connectionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (migrated > 0 || entries.length > 0) {
      this.save();
      logger.info('INTEGRATION_LEGACY_MIGRATED', `Migrated ${migrated} legacy secret(s) to secure vault.`);
    }
    return migrated;
  }

  hasLegacySecrets(): boolean {
    return Object.keys(this.legacySecrets).length > 0;
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedStore;
      this.data = {
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        secretRefs: parsed.secretRefs ?? {},
      };
      if (parsed.secrets && typeof parsed.secrets === 'object') {
        for (const [connectionId, secrets] of Object.entries(parsed.secrets)) {
          if (secrets && typeof secrets === 'object') {
            this.legacySecrets[connectionId] = secrets as IntegrationConnectionSecrets;
          }
        }
        if (Object.keys(this.legacySecrets).length > 0) {
          logger.warn(
            'INTEGRATION_LEGACY_SECRETS',
            `Found ${Object.keys(this.legacySecrets).length} legacy inline secret(s); will migrate on sign-in.`,
          );
        }
      }
    } catch (error) {
      logger.error('INTEGRATION_STORE_LOAD_FAILED', error instanceof Error ? error.message : String(error));
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      const payload: PersistedStore = {
        connections: this.data.connections,
        secretRefs: this.data.secretRefs,
      };
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
      logger.error('INTEGRATION_STORE_SAVE_FAILED', error instanceof Error ? error.message : String(error));
    }
  }
}
