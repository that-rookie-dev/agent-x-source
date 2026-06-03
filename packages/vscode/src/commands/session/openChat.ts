import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function openChatHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    await vscode.commands.executeCommand('agentx.chatView.focus');
    deps.outputChannel.appendLine('[Agent-X] Chat view focused.');
  };
}
