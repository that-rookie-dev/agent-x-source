import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function switchModelHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const currentProvider = deps.configBridge.getActiveProvider() || '';
    const models = await deps.engineLifecycle.getAvailableModels(currentProvider);

    if (models.length === 0) {
      vscode.window.showWarningMessage(`Agent-X: No models available for provider "${currentProvider}". Check your API key or provider configuration.`);
      return;
    }

    interface ModelQuickPickItem extends vscode.QuickPickItem {
      modelId: string;
    }

    const activeModel = deps.configBridge.getActiveModel();

    const items: ModelQuickPickItem[] = models.map((m) => ({
      label: m.id === activeModel ? `$(check) ${m.name}` : m.name,
      description: m.contextWindow ? `${formatNumber(m.contextWindow)} tokens` : undefined,
      detail: m.description || m.id,
      modelId: m.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select model for ${currentProvider}`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

    const modelId = (selected as ModelQuickPickItem).modelId;

    try {
      deps.configBridge.setActiveModel(modelId);
      await deps.engineLifecycle.switchModel(modelId);
      deps.statusBarManager.updateModelIndicator(modelId);

      vscode.window.showInformationMessage(`Agent-X: Switched to model "${selected.label}".`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to switch model — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
