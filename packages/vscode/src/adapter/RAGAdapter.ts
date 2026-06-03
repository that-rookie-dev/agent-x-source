import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { Agent, RAGEngine } from '@agentx/engine';

const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.dart',
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.html',
  '.css', '.scss', '.sql', '.sh', '.bash', '.zsh', '.lua', '.r',
]);

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '__pycache__', 'target', 'vendor', 'bin', 'obj', '.vscode',
  'coverage', '.nyc_output', '.idea', '.vs',
]);

export class RAGAdapter {
  private engine: Agent | null = null;
  private ragEngine: RAGEngine | null = null;
  private workspaceRoot: string = '';
  private statusBarItem: vscode.StatusBarItem;
  private indexingInProgress = false;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this.statusBarItem = statusBarItem;
  }

  attach(engine: Agent, workspaceRoot: string): void {
    this.engine = engine;
    this.workspaceRoot = workspaceRoot;
    const internal = engine as unknown as { ragEngine?: RAGEngine };
    this.ragEngine = internal.ragEngine ?? null;
    this.updateStatusBar();
  }

  get isAvailable(): boolean {
    return this.ragEngine !== null;
  }

  async indexWorkspace(progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    if (!this.ragEngine || this.indexingInProgress) return;

    this.indexingInProgress = true;
    this.statusBarItem.text = '$(sync~spin) Indexing workspace...';
    this.statusBarItem.show();

    try {
      const files = await this.collectFiles(this.workspaceRoot);
      const total = files.length;

      if (total === 0) {
        vscode.window.showInformationMessage('No indexable files found in workspace.');
        this.indexingInProgress = false;
        this.updateStatusBar();
        return;
      }

      let indexed = 0;

      for (let i = 0; i < files.length; i += 10) {
        const batch = files.slice(i, i + 10);
        const docs = batch.map(f => ({
          content: this.safeReadFile(f.path),
          id: f.relativePath,
          metadata: {
            path: f.relativePath,
            language: this.detectLanguage(f.path),
          },
        })).filter(d => d.content.length > 0);

        if (docs.length > 0) {
          await this.ragEngine.indexDocuments(docs);
        }

        indexed += batch.length;
        progress.report({
          message: `${indexed}/${total} files (${Math.round(indexed / total * 100)}%)`,
          increment: (batch.length / total) * 100,
        });
      }

      const chunkCount = await this.ragEngine.chunkCount();
      vscode.window.showInformationMessage(
        `Indexed ${total} files (${chunkCount} chunks) from workspace.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Indexing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.indexingInProgress = false;
      this.updateStatusBar();
    }
  }

  async clearIndex(): Promise<void> {
    if (!this.ragEngine) return;
    await this.ragEngine.clearAll();
    this.updateStatusBar();
    vscode.window.showInformationMessage('RAG index cleared.');
  }

  async search(query: string): Promise<Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>> {
    if (!this.ragEngine) return [];
    return this.ragEngine.search(query);
  }

  private updateStatusBar(): void {
    if (!this.ragEngine) {
      this.statusBarItem.hide();
      return;
    }

    const stats = (this.engine as unknown as { ragIndexStats?: { indexedCount: number; indexedAt: string | null } })?.ragIndexStats ?? { indexedCount: 0, indexedAt: null };

    if (stats.indexedCount > 0) {
      this.statusBarItem.text = `$(database) ${stats.indexedCount}`;
      const dateStr = stats.indexedAt
        ? new Date(stats.indexedAt).toLocaleString()
        : 'never';
      this.statusBarItem.tooltip = `Agent-X RAG: ${stats.indexedCount} chunks indexed at ${dateStr}`;
      this.statusBarItem.command = 'agentx.rag.reindex';
      this.statusBarItem.show();
    } else {
      this.statusBarItem.text = '$(database) Not indexed';
      this.statusBarItem.tooltip = 'Agent-X RAG: Click to index workspace';
      this.statusBarItem.command = 'agentx.rag.index';
      this.statusBarItem.show();
    }
  }

  private async collectFiles(dir: string): Promise<Array<{ path: string; relativePath: string }>> {
    const results: Array<{ path: string; relativePath: string }> = [];
    const uri = vscode.Uri.file(dir);

    const entries = await vscode.workspace.fs.readDirectory(uri);
    for (const [name, type] of entries) {
      const fullPath = join(dir, name);

      if (type === vscode.FileType.Directory) {
        if (!EXCLUDED_DIRS.has(name)) {
          const subFiles = await this.collectFiles(fullPath);
          results.push(...subFiles);
        }
      } else if (type === vscode.FileType.File) {
        const ext = extname(name).toLowerCase();
        if (INDEXABLE_EXTENSIONS.has(ext)) {
          results.push({
            path: fullPath,
            relativePath: relative(this.workspaceRoot, fullPath),
          });
        }
      }
    }

    return results;
  }

  private safeReadFile(filePath: string): string {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.length > 100_000) return content.slice(0, 100_000);
      return content;
    } catch {
      return '';
    }
  }

  private detectLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript',
      '.jsx': 'javascriptreact', '.py': 'python', '.rs': 'rust',
      '.go': 'go', '.java': 'java', '.rb': 'ruby', '.php': 'php',
      '.md': 'markdown', '.json': 'json', '.yaml': 'yaml',
      '.sql': 'sql', '.sh': 'shellscript', '.html': 'html',
      '.css': 'css', '.swift': 'swift', '.kt': 'kotlin',
    };
    return map[ext] ?? 'plaintext';
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
