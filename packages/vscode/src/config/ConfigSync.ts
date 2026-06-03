import * as vscode from 'vscode';
import { ConfigManager } from '@agentx/engine';
import type { CommandDeps } from '../commands/registerAllCommands';

const DEBOUNCE_MS = 1000;

export class ConfigSync implements vscode.Disposable {
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private isSyncing = false;
  private configManager: ConfigManager;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private deps: CommandDeps,
  ) {
    this.configManager = new ConfigManager();
    this.setupFileWatcher();
    this.setupSettingsWatcher();
  }

  private setupFileWatcher(): void {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (!homeDir) return;

    const pattern = new vscode.RelativePattern(homeDir + '/.config/agentx', 'config.json');
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.fileWatcher.onDidChange(() => this.onExternalChange());
    this.fileWatcher.onDidCreate(() => this.onExternalChange());
    this.fileWatcher.onDidDelete(() => this.onExternalDelete());

    this.disposables.push(this.fileWatcher);
  }

  private setupSettingsWatcher(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (this.isSyncing) return;

        if (event.affectsConfiguration('agentx.provider')) {
          this.onVSCodeSettingsChanged();
        }
        if (event.affectsConfiguration('agentx.model')) {
          this.onVSCodeSettingsChanged();
        }
      }),
    );
  }

  private onExternalChange(): void {
    if (this.isSyncing) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        this.isSyncing = true;
        const config = this.configManager.reload();
        if (config) {
          this.deps.configBridge.reload();
          vscode.commands.executeCommand('agentx.refreshSessions');
        }
      } catch {
        // Ignore parse errors in file watcher
      } finally {
        this.isSyncing = false;
      }
    }, DEBOUNCE_MS);
  }

  private onExternalDelete(): void {
    // Config file deleted — show warning
    vscode.window.showWarningMessage(
      'Agent-X: Config file deleted at ~/.config/agentx/config.json. The extension will use cached settings.',
    );
  }

  private async onVSCodeSettingsChanged(): Promise<void> {
    if (this.isSyncing) return;

    const vsConfig = vscode.workspace.getConfiguration('agentx');
    const provider = vsConfig.get<string>('provider');
    const model = vsConfig.get<string>('model');

    if (provider) {
      this.deps.configBridge.setActiveProvider(provider);
    }
    if (model) {
      this.deps.configBridge.setActiveModel(model);
    }

    await this.deps.configBridge.saveConfig();
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
