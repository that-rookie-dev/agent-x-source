import * as vscode from 'vscode';
import * as path from 'path';
import type { CommandDeps } from '../registerAllCommands';

export function exportSessionHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showWarningMessage('Agent-X: No active session to export.');
      return;
    }

    const formatChoice = await vscode.window.showQuickPick(
      [
        { label: '$(json) JSON', description: 'Full session data as JSON', format: 'json' },
        { label: '$(markdown) Markdown', description: 'Human-readable conversation', format: 'markdown' },
      ],
      { placeHolder: 'Select export format' },
    );

    if (!formatChoice) return;

    const sessionId = deps.engineLifecycle.getCurrentSessionId();
    const session = await deps.engineLifecycle.getSessionData(sessionId);

    const format = (formatChoice as { format: string }).format;
    const defaultName = `agentx-session-${sessionId?.slice(0, 8)}.${format}`;

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.HOME || '.',
          defaultName,
        ),
      ),
      filters: format === 'json' ? { 'JSON Files': ['json'] } : { 'Markdown Files': ['md'] },
    });

    if (!saveUri) return;

    try {
      let content: string;

      if (format === 'json') {
        content = JSON.stringify(session, null, 2);
      } else {
        content = formatSessionAsMarkdown(session);
      }

      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));

      const openChoice = await vscode.window.showInformationMessage(
        `Agent-X: Session exported to ${path.basename(saveUri.fsPath)}`,
        'Open File',
        'Reveal in Explorer',
      );

      if (openChoice === 'Open File') {
        const doc = await vscode.workspace.openTextDocument(saveUri);
        await vscode.window.showTextDocument(doc);
      } else if (openChoice === 'Reveal in Explorer') {
        await vscode.commands.executeCommand('revealFileInOS', saveUri);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Export failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

function formatSessionAsMarkdown(session: { messages: Array<{ role: string; content: string; timestamp?: string }>; title?: string; model?: string }): string {
  const lines: string[] = [];
  lines.push(`# ${session.title || 'Agent-X Session'}`);
  lines.push('');
  lines.push(`**Model**: ${session.model || 'unknown'}`);
  lines.push(`**Exported**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of session.messages) {
    const roleLabel = msg.role === 'user' ? '**User**' : '**Assistant**';
    const timestamp = msg.timestamp ? ` _${msg.timestamp}_` : '';
    lines.push(`### ${roleLabel}${timestamp}`);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}
