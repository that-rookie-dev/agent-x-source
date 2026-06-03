import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function switchProviderHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const providers = deps.configBridge.getAvailableProviders();
    const activeProvider = deps.configBridge.getActiveProvider();

    interface ProviderQuickPickItem extends vscode.QuickPickItem {
      providerId: string;
    }

    const items: ProviderQuickPickItem[] = providers.map((p) => ({
      label: p.id === activeProvider ? `$(check) ${p.name}` : p.name,
      description: p.configured ? '$(pass-filled) Configured' : '$(warning) Not configured',
      detail: p.description || p.id,
      providerId: p.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select AI provider',
      matchOnDescription: true,
    });

    if (!selected) return;

    const providerId = (selected as ProviderQuickPickItem).providerId;
    const providerInfo = providers.find((p) => p.id === providerId);

    if (!providerInfo?.configured) {
      const configure = await vscode.window.showWarningMessage(
        `Provider "${selected.label}" is not configured. Would you like to configure it?`,
        'Configure',
        'Cancel',
      );
      if (configure === 'Configure') {
        await vscode.commands.executeCommand('agentx.configureProvider', providerId);
      }
      return;
    }

    try {
      deps.configBridge.setActiveProvider(providerId);
      await deps.engineLifecycle.switchProvider(providerId);
      deps.statusBarManager.updateProviderIndicator(providerId);

      const models = await deps.engineLifecycle.getAvailableModels(providerId);
      if (models.length > 0) {
        deps.configBridge.setActiveModel(models[0].id);
        deps.statusBarManager.updateModelIndicator(models[0].id);
      }

      vscode.window.showInformationMessage(`Agent-X: Switched to provider "${selected.label}".`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to switch provider — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
