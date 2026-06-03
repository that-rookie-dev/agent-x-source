import * as vscode from 'vscode';

export class ContextKeyManager implements vscode.Disposable {
  private keys: Map<string, boolean> = new Map();
  private static readonly KNOWN_KEYS = [
    'agentx.isProcessing',
    'agentx.hasSession',
    'agentx.isConfigured',
    'agentx.planMode',
    'agentx.hasPermissionRequest',
  ] as const;

  constructor() {
    for (const key of ContextKeyManager.KNOWN_KEYS) {
      this.keys.set(key, false);
      vscode.commands.executeCommand('setContext', key, false);
    }
  }

  set(key: string, value: boolean): void {
    const currentValue = this.keys.get(key);
    if (currentValue === value) return;

    this.keys.set(key, value);
    vscode.commands.executeCommand('setContext', key, value);
  }

  get(key: string): boolean {
    return this.keys.get(key) || false;
  }

  resetAll(): void {
    for (const key of this.keys.keys()) {
      this.keys.set(key, false);
      vscode.commands.executeCommand('setContext', key, false);
    }
  }

  dispose(): void {
    this.resetAll();
  }
}
