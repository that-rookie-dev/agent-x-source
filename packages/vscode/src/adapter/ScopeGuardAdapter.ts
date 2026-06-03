import * as vscode from 'vscode';
import { ScopeGuard } from '@agentx/engine';
import type { EventBridge } from './EventBridge';

export interface ScopeValidationResult {
  valid: boolean;
  resolved: string;
  error?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
}

export class ScopeGuardAdapter implements vscode.Disposable {
  private scopeGuards: Map<string, ScopeGuard> = new Map();
  private disposables: vscode.Disposable[] = [];
  private outputChannel: vscode.OutputChannel;

  constructor(
    _eventBridge: EventBridge,
    outputChannel: vscode.OutputChannel,
  ) {
    this.outputChannel = outputChannel;
    this.initializeGuards();

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const removed of e.removed) {
          this.scopeGuards.delete(removed.uri.fsPath);
        }
        for (const added of e.added) {
          this.createGuard(added);
        }
        this.outputChannel.appendLine(
          `[ScopeGuard] Workspace folders changed. Active scopes: ${this.getScopeRoots().join(', ')}`,
        );
      }),
    );
  }

  private initializeGuards(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
    for (const folder of folders) {
      this.createGuard(folder);
    }
  }

  private createGuard(folder: vscode.WorkspaceFolder): void {
    const guard = new ScopeGuard(folder.uri.fsPath, true);
    this.scopeGuards.set(folder.uri.fsPath, guard);
    this.outputChannel.appendLine(
      `[ScopeGuard] Initialized scope: ${folder.uri.fsPath} (git-aware)`,
    );
  }

  validatePath(targetPath: string): ScopeValidationResult {
    for (const [, guard] of this.scopeGuards) {
      const result = guard.validatePath(targetPath);
      if (result.valid) {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath));
        return {
          valid: true,
          resolved: result.resolved,
          workspaceFolder: folder,
        };
      }
    }

    const primaryGuard = this.getPrimaryGuard();
    if (primaryGuard) {
      const result = primaryGuard.validatePath(targetPath);
      return {
        valid: false,
        resolved: result.resolved,
        error: result.error ?? `Path is outside all workspace folders: ${targetPath}`,
      };
    }

    return {
      valid: false,
      resolved: targetPath,
      error: 'No workspace folder is open',
    };
  }

  isWithinScope(targetPath: string): boolean {
    for (const guard of this.scopeGuards.values()) {
      if (guard.isWithinScope(targetPath)) return true;
    }
    return false;
  }

  showBlockedNotification(targetPath: string, error: string): void {
    const message = `Agent-X: Operation blocked — ${error}`;
    vscode.window.showErrorMessage(message, 'Show Scope').then((action) => {
      if (action === 'Show Scope') {
        const roots = this.getScopeRoots();
        if (roots.length > 0) {
          vscode.window.showInformationMessage(
            `Allowed workspace folders:\n${roots.map((r) => `  • ${r}`).join('\n')}`,
          );
        }
      }
    });
    this.outputChannel.appendLine(`[ScopeGuard] BLOCKED: ${targetPath} — ${error}`);
  }

  getPrimaryGuard(): ScopeGuard | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    const first = folders[0];
    if (!first) return null;
    return this.scopeGuards.get(first.uri.fsPath) ?? null;
  }

  getScopeRoots(): string[] {
    const roots: string[] = [];
    this.scopeGuards.forEach((_, key) => roots.push(key));
    return roots;
  }

  getPrimaryScopeRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    const first = folders[0];
    return first?.uri.fsPath ?? null;
  }

  updateScopePath(newRoot: string): void {
    const existingGuard = this.scopeGuards.get(newRoot);
    if (!existingGuard) {
      const guard = new ScopeGuard(newRoot, true);
      this.scopeGuards.set(newRoot, guard);
      this.outputChannel.appendLine(`[ScopeGuard] Added scope: ${newRoot}`);
    }
  }

  getGuardForPath(targetPath: string): ScopeGuard | null {
    for (const [root, guard] of this.scopeGuards) {
      if (targetPath.startsWith(root)) return guard;
    }
    return this.getPrimaryGuard();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.scopeGuards.clear();
  }
}
