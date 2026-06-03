import * as vscode from 'vscode';

const MIGRATION_FLAG_KEY = 'agentx.secrets.migrated';

export class SecretStorageBridge {
  private secrets: vscode.SecretStorage;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.secrets = context.secrets;
  }

  async storeApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.secrets.store(`agentx.apiKey.${providerId}`, apiKey);
  }

  async getApiKey(providerId: string): Promise<string | undefined> {
    return this.secrets.get(`agentx.apiKey.${providerId}`);
  }

  async deleteApiKey(providerId: string): Promise<void> {
    await this.secrets.delete(`agentx.apiKey.${providerId}`);
  }

  async migrateFromConfig(configApiKeys: Record<string, string>): Promise<void> {
    const migrated = this.context.globalState.get<boolean>(MIGRATION_FLAG_KEY);
    if (migrated) return;

    for (const [providerId, apiKey] of Object.entries(configApiKeys)) {
      if (apiKey) {
        await this.storeApiKey(providerId, apiKey);
      }
    }
    await this.context.globalState.update(MIGRATION_FLAG_KEY, true);
  }

  async clearAll(): Promise<void> {
    for (const key of await this.secrets.keys()) {
      if (key.startsWith('agentx.apiKey.')) {
        await this.secrets.delete(key);
      }
    }
    await this.context.globalState.update(MIGRATION_FLAG_KEY, false);
  }
}
