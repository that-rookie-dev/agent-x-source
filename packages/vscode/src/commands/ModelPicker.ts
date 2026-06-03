import * as vscode from 'vscode';
import type { CommandDeps } from './registerAllCommands';

interface ModelQuickPickItem extends vscode.QuickPickItem {
  modelId: string;
  contextWindow: number;
}

export function showModelPicker(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const currentProvider = deps.configBridge.getActiveProvider() || '';
    const activeModel = deps.configBridge.getActiveModel() || '';

    const models = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching models from ${currentProvider}...`,
        cancellable: true,
      },
      async (_progress, _token) => {
        try {
          return await deps.engineLifecycle.getAvailableModels(currentProvider);
        } catch {
          return [];
        }
      },
    );

    if (!models || models.length === 0) {
      const action = await vscode.window.showWarningMessage(
        `Agent-X: No models available for provider "${currentProvider}". Check your API key or provider configuration.`,
        'Configure Provider',
        'Dismiss',
      );
      if (action === 'Configure Provider') {
        await vscode.commands.executeCommand('agentx.configureProvider');
      }
      return;
    }

    const items: ModelQuickPickItem[] = models.map((m) => {
      const isActive = m.id === activeModel;
      const ctxLabel = formatContextWindow(m.contextWindow);

      return {
        label: isActive ? `$(check) ${m.name || m.id}` : (m.name || m.id),
        description: ctxLabel,
        detail: m.description || m.id,
        modelId: m.id,
        contextWindow: m.contextWindow,
      };
    });

    items.sort((a, b) => {
      if (a.modelId === activeModel) return -1;
      if (b.modelId === activeModel) return 1;
      return a.label.localeCompare(b.label);
    });

    const quickPick = vscode.window.createQuickPick<ModelQuickPickItem>();
    quickPick.items = items;
    quickPick.placeholder = `Select model for ${currentProvider} (${models.length} available)`;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.title = 'Agent-X: Switch Model';
    quickPick.busy = false;

    const result = await new Promise<ModelQuickPickItem | undefined>((resolve) => {
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        resolve(selected);
        quickPick.dispose();
      });
      quickPick.onDidHide(() => {
        resolve(undefined);
        quickPick.dispose();
      });
      quickPick.show();
    });

    if (!result) return;

    if (result.modelId === activeModel) {
      vscode.window.showInformationMessage(`Agent-X: Already using ${result.modelId}.`);
      return;
    }

    await trialAndSwitchModel(deps, result.modelId, result.contextWindow, result.label.replace(/^\$\(check\)\s*/, ''));
  };
}

async function trialAndSwitchModel(
  deps: CommandDeps,
  modelId: string,
  contextWindow: number,
  displayName: string,
): Promise<void> {
  try {
    deps.configBridge.setActiveModel(modelId);
    await deps.engineLifecycle.switchModel(modelId);
    deps.statusBarManager.updateModelIndicator(modelId);

    vscode.window.showInformationMessage(`Agent-X: Switched to model "${displayName}" (${formatContextWindow(contextWindow)} context).`);
    deps.outputChannel.appendLine(`[Agent-X] Model switched to ${modelId} (ctx: ${contextWindow}).`);
  } catch {
    const action = await vscode.window.showWarningMessage(
      `Agent-X: Model "${displayName}" failed. Pick another?`,
      'Pick Another Model',
      'Dismiss',
    );
    if (action === 'Pick Another Model') {
      await vscode.commands.executeCommand('agentx.switchModel');
    }
  }
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K tokens`;
  return `${tokens} tokens`;
}
