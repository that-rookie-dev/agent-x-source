import * as vscode from 'vscode';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { getSecretSauceDir } from '@agentx/shared';

type SauceNodeKind = 'file' | 'directory';

export interface SauceTreeItem {
  kind: SauceNodeKind;
  label: string;
  filePath: string;
  description?: string;
}

export class SecretSauceBrowser implements vscode.TreeDataProvider<SauceTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SauceTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SauceTreeItem): vscode.TreeItem {
    const isDir = element.kind === 'directory';
    const item = new vscode.TreeItem(
      element.label,
      isDir
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    item.description = element.description;

    if (isDir) {
      item.iconPath = new vscode.ThemeIcon('folder');
      item.contextValue = 'sauce-directory';
    } else {
      const ext = extname(element.filePath).toLowerCase();
      const iconMap: Record<string, string> = {
        '.md': 'markdown',
        '.json': 'json',
        '.txt': 'file-text',
      };
      item.iconPath = new vscode.ThemeIcon(iconMap[ext] ?? 'file');
      item.contextValue = 'sauce-file';
      item.command = {
        command: 'agentx.sauce.openFile',
        title: 'Open File',
        arguments: [element.filePath],
      };
      item.resourceUri = vscode.Uri.file(element.filePath);
    }

    return item;
  }

  getChildren(element?: SauceTreeItem): SauceTreeItem[] {
    const sauceDir = getSecretSauceDir();

    if (!existsSync(sauceDir)) {
      return [{
        kind: 'file',
        label: 'Secret sauce directory not found',
        filePath: sauceDir,
        description: 'Start a conversation to initialize',
      }];
    }

    const dirPath = element ? element.filePath : sauceDir;
    return this.readDirectory(dirPath);
  }

  private readDirectory(dirPath: string): SauceTreeItem[] {
    if (!existsSync(dirPath)) return [];

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const items: SauceTreeItem[] = [];

      const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));

      for (const dir of dirs) {
        items.push({
          kind: 'directory',
          label: dir.name,
          filePath: join(dirPath, dir.name),
        });
      }

      for (const file of files) {
        const fullPath = join(dirPath, file.name);
        let size = '';
        try {
          const st = statSync(fullPath);
          size = this.formatSize(st.size);
        } catch {
          size = '?';
        }

        items.push({
          kind: 'file',
          label: file.name,
          filePath: fullPath,
          description: size,
        });
      }

      return items;
    } catch {
      return [];
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async openInExplorer(): Promise<void> {
    const sauceDir = getSecretSauceDir();
    if (!existsSync(sauceDir)) {
      vscode.window.showWarningMessage('Secret sauce directory does not exist yet.');
      return;
    }
    const uri = vscode.Uri.file(sauceDir);
    await vscode.commands.executeCommand('revealFileInOS', uri);
  }

  async openFile(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      vscode.window.showErrorMessage(`File not found: ${filePath}`);
      return;
    }
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
