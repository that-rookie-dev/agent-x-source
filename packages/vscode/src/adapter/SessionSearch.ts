import * as vscode from 'vscode';
import { EngineLifecycle } from './EngineLifecycle';
import type { SessionPersistence } from './SessionPersistence';
import type { SessionTreeProvider } from '../views/SessionTreeProvider';

interface SessionSearchResult {
  sessionId: string;
  sessionTitle: string;
  sessionDate: string;
  matchingSnippet: string;
  matchCount: number;
  matchedMessageIndices: number[];
}

export class SessionSearch {
  constructor(
    private readonly engineLifecycle: EngineLifecycle,
    private readonly persistence: SessionPersistence,
  ) {}

  search(query: string, limit = 50): Promise<SessionSearchResult[]> {
    return this.doSearch(query, limit);
  }

  private async doSearch(query: string, limit = 50): Promise<SessionSearchResult[]> {
    const queryLower = query.toLowerCase();
    const sessions = await this.engineLifecycle.listSessions();
    const results: SessionSearchResult[] = [];

    for (const session of sessions) {
      if (results.length >= limit) break;

      const messages = this.persistence.loadMessages(session.id);
      if (messages.length === 0) continue;

      const matchedIndices: number[] = [];
      let matchCount = 0;
      let firstSnippet = '';

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg) continue;

        const contentLower = msg.content.toLowerCase();
        let idx = contentLower.indexOf(queryLower);

        if (idx >= 0) {
          matchedIndices.push(i);
          matchCount++;

          if (firstSnippet === '') {
            const start = Math.max(0, idx - 30);
            const end = Math.min(msg.content.length, idx + query.length + 50);
            firstSnippet = (start > 0 ? '...' : '') +
              msg.content.substring(start, end) +
              (end < msg.content.length ? '...' : '');
          }

          while (idx !== -1) {
            idx = contentLower.indexOf(queryLower, idx + 1);
            if (idx >= 0) matchCount++;
          }
        }
      }

      if (matchCount > 0) {
        results.push({
          sessionId: session.id,
          sessionTitle: session.title || 'New Session',
          sessionDate: session.updatedAt,
          matchingSnippet: firstSnippet,
          matchCount,
          matchedMessageIndices: matchedIndices,
        });
      }
    }

    results.sort((a, b) => b.matchCount - a.matchCount);
    return results;
  }

  async showSearchUI(_treeProvider: SessionTreeProvider): Promise<void> {
    const query = await vscode.window.showInputBox({
      prompt: 'Search across all sessions',
      placeHolder: 'Type to search messages...',
    });

    if (!query || query.trim().length === 0) return;

    const results = await this.search(query.trim());

    if (results.length === 0) {
      vscode.window.showInformationMessage(`No sessions found matching "${query}".`);
      return;
    }

    interface SearchPickItem extends vscode.QuickPickItem {
      sessionId: string;
    }

    const items: SearchPickItem[] = results.map((r) => ({
      label: `$(history) ${r.sessionTitle}`,
      description: `${r.matchCount} match${r.matchCount !== 1 ? 'es' : ''} · ${new Date(r.sessionDate).toLocaleDateString()}`,
      detail: r.matchingSnippet,
      sessionId: r.sessionId,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} session${results.length !== 1 ? 's' : ''} matching "${query}"`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await vscode.commands.executeCommand('agentx.session.restore', selected.sessionId);
    }
  }
}
