import * as vscode from 'vscode';

export class AgentXCompletionProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    _document: vscode.TextDocument,
    _position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
    return [];
  }
}
