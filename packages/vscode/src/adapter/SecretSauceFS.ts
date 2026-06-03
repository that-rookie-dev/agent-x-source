import * as vscode from 'vscode';

export class SecretSauceFileSystemProvider implements vscode.FileSystemProvider {
  private sauce: { getEntry: (path: string) => { content?: string; createdAt?: Date; updatedAt?: Date } | undefined; list: () => Array<{ id: string }>; save: (path: string, content: string) => void; delete: (path: string) => void } | null = null;
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  attach(sauce: typeof SecretSauceFileSystemProvider.prototype.sauce): void {
    this.sauce = sauce;
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    if (!this.sauce) throw vscode.FileSystemError.FileNotFound(uri);
    const path = uri.path;
    if (path === '/') {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const entry = this.sauce.getEntry(path.slice(1));
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);

    return {
      type: vscode.FileType.File,
      ctime: entry.createdAt?.getTime() ?? 0,
      mtime: entry.updatedAt?.getTime() ?? 0,
      size: Buffer.byteLength(entry.content ?? ''),
    };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    if (!this.sauce) return [];
    if (uri.path !== '/') throw vscode.FileSystemError.FileNotFound(uri);
    return this.sauce.list().map((entry) => [entry.id, vscode.FileType.File]);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    if (!this.sauce) throw vscode.FileSystemError.FileNotFound(uri);
    const entry = this.sauce.getEntry(uri.path.slice(1));
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
    return Buffer.from(entry.content ?? '', 'utf-8');
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void {
    if (!this.sauce) return;
    this.sauce.save(uri.path.slice(1), Buffer.from(content).toString('utf-8'));
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(uri: vscode.Uri): void {
    if (!this.sauce) return;
    this.sauce.delete(uri.path.slice(1));
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    if (!this.sauce) return;
    const content = this.sauce.getEntry(oldUri.path.slice(1))?.content;
    if (content !== undefined) {
      this.sauce.save(newUri.path.slice(1), content);
      this.sauce.delete(oldUri.path.slice(1));
    }
  }

  createDirectory(_uri: vscode.Uri): void {}

  watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }
}
