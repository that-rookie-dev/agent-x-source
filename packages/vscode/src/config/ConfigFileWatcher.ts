import * as vscode from 'vscode';
import { ConfigBridge } from '../adapter/ConfigBridge';
import { StatusBarManager } from '../statusbar/StatusBarManager';
import { EngineLifecycle } from '../adapter/EngineLifecycle';
import { getConfigDir } from '@agentx/engine';

export class ConfigFileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private configBridge: ConfigBridge,
    private statusBarManager: StatusBarManager,
    _engineLifecycle: EngineLifecycle,
  ) {
    void _engineLifecycle;
    const configDir = getConfigDir();
    const configPattern = new vscode.RelativePattern(configDir, 'config.json');

    this.watcher = vscode.workspace.createFileSystemWatcher(configPattern);

    this.watcher.onDidChange(() => this.onConfigFileChanged());
    this.watcher.onDidCreate(() => this.onConfigFileChanged());
    this.watcher.onDidDelete(() => this.onConfigFileDeleted());
  }

  private onConfigFileChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        await this.configBridge.reloadFromDisk();
        this.statusBarManager.initializeFromConfig(this.configBridge.getConfig() || {} as any);
        this.statusBarManager.updateCrewIndicator(this.configBridge.getActiveCrewName());
      } catch (error) {
        vscode.window.showWarningMessage(`Agent-X: Config file changed but reload failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 500);
  }

  private async onConfigFileDeleted(): Promise<void> {
    vscode.window.showWarningMessage('Agent-X: Config file was deleted. Extension may not work correctly.');
    this.statusBarManager.updateProviderIndicator('none');
    this.statusBarManager.updateModelIndicator('none');
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.watcher?.dispose();
  }
}
