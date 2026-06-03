import * as vscode from 'vscode';
import type { EventBridge } from './EventBridge';
import type { Disposable } from './types';

const AGENTX_DIFF_SCHEME = 'agentx-diff';

interface DiffPreviewRequest {
  tool: string;
  filePath: string;
  diff: string;
  oldContent?: string;
  newContent?: string;
}

class DiffDocumentProvider implements vscode.TextDocumentContentProvider {
  private documents = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  setContent(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  remove(uri: vscode.Uri): void {
    this.documents.delete(uri.toString());
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.documents.clear();
  }
}

export class DiffPreviewHandler implements vscode.Disposable {
  private disposables: Disposable[] = [];
  private documentProvider: DiffDocumentProvider;
  private documentProviderRegistration: vscode.Disposable | null = null;
  private activeDiffEditors = new Map<string, DiffPreviewRequest>();
  private pendingResolves = new Map<string, (accepted: boolean) => void>();
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly eventBridge: EventBridge,
    outputChannel: vscode.OutputChannel,
  ) {
    this.outputChannel = outputChannel;
    this.documentProvider = new DiffDocumentProvider();

    this.documentProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(
      AGENTX_DIFF_SCHEME,
      this.documentProvider,
    );

    this.disposables.push(
      this.eventBridge.onDiffPreview((p) => this.handleDiffPreview(p)),
    );

    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.scheme === AGENTX_DIFF_SCHEME) {
          this.documentProvider.remove(doc.uri);
        }
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand('agentx.diffAccept', () => this.acceptCurrentDiff()),
      vscode.commands.registerCommand('agentx.diffReject', () => this.rejectCurrentDiff()),
    );
  }

  private async handleDiffPreview(preview: DiffPreviewRequest): Promise<void> {
    this.outputChannel.appendLine(
      `[DiffPreview] Showing diff for ${preview.filePath} (tool: ${preview.tool})`,
    );

    const oldContent = preview.oldContent ?? '';
    const newContent = preview.newContent ?? '';

    const encodedPath = encodeURIComponent(preview.filePath);
    const timestamp = Date.now();
    const oldUri = vscode.Uri.parse(
      `${AGENTX_DIFF_SCHEME}:original/${encodedPath}?t=${timestamp}`,
    );
    const newUri = vscode.Uri.parse(
      `${AGENTX_DIFF_SCHEME}:modified/${encodedPath}?t=${timestamp}`,
    );

    this.documentProvider.setContent(oldUri, oldContent);
    this.documentProvider.setContent(newUri, newContent);

    const fileName = preview.filePath.split('/').pop() ?? preview.filePath;
    const title = `${fileName} (Original ↔ Modified by ${preview.tool})`;

    this.activeDiffEditors.set(preview.filePath, preview);

    try {
      await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, title, {
        preview: true,
        preserveFocus: false,
      });
    } catch (error) {
      this.outputChannel.appendLine(
        `[DiffPreview] Failed to open diff editor: ${error}`,
      );
    }
  }

  registerDiffResolve(filePath: string, resolve: (accepted: boolean) => void): void {
    this.pendingResolves.set(filePath, resolve);
  }

  private acceptCurrentDiff(): void {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return;

    for (const [filePath, resolve] of this.pendingResolves) {
      resolve(true);
      this.pendingResolves.delete(filePath);
      this.activeDiffEditors.delete(filePath);
      this.outputChannel.appendLine(`[DiffPreview] Accepted: ${filePath}`);
      vscode.window.showInformationMessage(`Agent-X: Changes to ${filePath} accepted.`);
      this.closeDiffEditor();
      return;
    }

    vscode.window.showInformationMessage('Agent-X: No pending diff to accept.');
  }

  private rejectCurrentDiff(): void {
    for (const [filePath, resolve] of this.pendingResolves) {
      resolve(false);
      this.pendingResolves.delete(filePath);
      this.activeDiffEditors.delete(filePath);
      this.outputChannel.appendLine(`[DiffPreview] Rejected: ${filePath}`);
      vscode.window.showInformationMessage(`Agent-X: Changes to ${filePath} rejected.`);
      this.closeDiffEditor();
      return;
    }

    vscode.window.showInformationMessage('Agent-X: No pending diff to reject.');
  }

  private closeDiffEditor(): void {
    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }

  getActiveDiffs(): string[] {
    return Array.from(this.activeDiffEditors.keys());
  }

  dispose(): void {
    for (const resolve of this.pendingResolves.values()) {
      resolve(false);
    }
    this.pendingResolves.clear();
    this.activeDiffEditors.clear();

    if (this.documentProviderRegistration) {
      this.documentProviderRegistration.dispose();
    }
    this.documentProvider.dispose();

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
