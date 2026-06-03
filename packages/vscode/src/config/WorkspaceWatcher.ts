import * as vscode from 'vscode';
import { EngineLifecycle } from '../adapter/EngineLifecycle';
import { StatusBarManager } from '../statusbar/StatusBarManager';
import { ChatViewProvider } from '../webview/ChatViewProvider';

export class WorkspaceWatcher implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor(
    private engineLifecycle: EngineLifecycle,
    private statusBarManager: StatusBarManager,
    private chatViewProvider: ChatViewProvider,
  ) {
    this.disposable = vscode.workspace.onDidChangeWorkspaceFolders((event) => this.onWorkspaceFoldersChanged(event));
  }

  private async onWorkspaceFoldersChanged(event: vscode.WorkspaceFoldersChangeEvent): Promise<void> {
    const added = event.added;
    const removed = event.removed;

    if (removed.length > 0 && added.length === 0) {
      if (this.engineLifecycle.hasActiveAgent()) {
        await this.engineLifecycle.disposeCurrentAgent();
        this.statusBarManager.updateSessionIndicator(undefined);
        this.chatViewProvider.notifyWorkspaceRemoved();
      }
      return;
    }

    if (added.length > 0) {
      const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!newRoot) return;

      const wasRunning = this.engineLifecycle.hasActiveAgent();

      if (wasRunning) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Agent-X: Workspace changed. Re-initializing engine...',
            cancellable: false,
          },
          async () => {
            await this.engineLifecycle.disposeCurrentAgent();
            this.engineLifecycle.setWorkspaceRoot(newRoot!);
            await this.engineLifecycle.createAgent();
          },
        );
      } else {
        this.engineLifecycle.setWorkspaceRoot(newRoot);
      }

      this.statusBarManager.updateSessionIndicator(this.engineLifecycle.getCurrentSessionId());
      this.chatViewProvider.notifyWorkspaceChanged(newRoot);

      vscode.window.showInformationMessage(`Agent-X: Workspace changed to ${newRoot}. Engine ${wasRunning ? 're-initialized' : 'root updated'}.`);
    }
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
