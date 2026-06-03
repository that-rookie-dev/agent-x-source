import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function searchSessionsHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search across all sessions',
      placeHolder: 'Enter search term...',
      validateInput: (value) => {
        if (!value || value.trim().length < 2) return 'Enter at least 2 characters';
        return undefined;
      },
    });

    if (!query) return;

    try {
      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Searching sessions for "${query}"...`,
          cancellable: true,
        },
        async (_progress, token) => {
          return deps.engineLifecycle.searchSessions(query, token);
        },
      );

      if (!results || results.length === 0) {
        vscode.window.showInformationMessage(`Agent-X: No sessions found matching "${query}".`);
        return;
      }

      interface SearchResultItem extends vscode.QuickPickItem {
        sessionId: string;
      }

      const items: SearchResultItem[] = results.map((r) => ({
        label: `$(search) ${r.sessionTitle || 'Untitled'}`,
        description: `Match in ${r.role} message`,
        detail: truncate(r.matchSnippet, 120),
        sessionId: r.sessionId,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} result(s) found — select to restore session`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        await deps.engineLifecycle.disposeCurrentAgent();
        await deps.engineLifecycle.restoreSession((selected as SearchResultItem).sessionId);
        deps.statusBarManager.updateSessionIndicator((selected as SearchResultItem).sessionId);
      }
    } catch (error) {
      if ((error as Error).name !== 'CancellationError') {
        vscode.window.showErrorMessage(`Agent-X: Search failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
