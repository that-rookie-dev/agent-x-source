import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function configureProviderHandler(deps: CommandDeps): (providerId?: string) => Promise<void> {
  return async (providerId?: string) => {
    if (!providerId) {
      const providers = deps.configBridge.getAvailableProviders();

      interface ProviderQuickPickItem extends vscode.QuickPickItem {
        providerId: string;
      }

      const items: ProviderQuickPickItem[] = providers.map((p) => ({
        label: p.name,
        description: p.configured ? 'Configured' : 'Not configured',
        providerId: p.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select provider to configure',
      });

      if (!selected) return;
      providerId = (selected as ProviderQuickPickItem).providerId;
    }

    const providerMeta = deps.configBridge.getProviderMeta(providerId);
    if (!providerMeta) {
      vscode.window.showErrorMessage(`Agent-X: Unknown provider "${providerId}".`);
      return;
    }

    const isLocal = ['ollama', 'lmstudio'].includes(providerId);

    if (!isLocal) {
      const apiKey = await vscode.window.showInputBox({
        prompt: `Enter API key for ${providerMeta.name}`,
        placeHolder: 'sk-...',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) return 'API key cannot be empty';
          return undefined;
        },
      });

      if (!apiKey) return;

      deps.configBridge.setProviderApiKey(providerId as any, apiKey.trim());
    }

    if (isLocal || providerMeta.supportsCustomUrl) {
      const defaultUrl = providerMeta.defaultBaseUrl || '';
      const baseUrl = await vscode.window.showInputBox({
        prompt: `Enter base URL for ${providerMeta.name}`,
        placeHolder: defaultUrl,
        value: deps.configBridge.getProviderBaseUrl(providerId as any) || defaultUrl,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (value && value.trim().length > 0) {
            try {
              new URL(value);
            } catch {
              return 'Must be a valid URL';
            }
          }
          return undefined;
        },
      });

      if (baseUrl) {
        deps.configBridge.setProviderBaseUrl(providerId as any, baseUrl.trim());
      }
    }

    try {
      await deps.configBridge.saveConfig();
      await deps.engineLifecycle.reloadProvider(providerId);

      vscode.window.showInformationMessage(`Agent-X: Provider "${providerMeta.name}" configured successfully.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to save provider config — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
