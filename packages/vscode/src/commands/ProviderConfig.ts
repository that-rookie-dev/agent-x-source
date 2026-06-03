import * as vscode from 'vscode';
import type { ProviderId } from '@agentx/shared';
import type { CommandDeps } from './registerAllCommands';
import { PROVIDER_REGISTRY, getProviderMeta } from './ProviderPicker';

export function showProviderConfig(deps: CommandDeps): (providerId?: string) => Promise<void> {
  return async (providerId?: string) => {
    if (!providerId) {
      const providerItems = PROVIDER_REGISTRY.map((p) => ({
        label: `${p.icon} ${p.name}`,
        description: p.type === 'cloud' ? 'Cloud' : 'Local',
        detail: p.description,
        providerId: p.id,
      }));

      const selected = await vscode.window.showQuickPick(providerItems, {
        placeHolder: 'Select provider to configure',
        title: 'Agent-X: Configure Provider',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected) return;
      providerId = (selected as { providerId: string }).providerId;
    }

    const meta = getProviderMeta(providerId as ProviderId);
    if (!meta) {
      vscode.window.showErrorMessage(`Agent-X: Unknown provider "${providerId}".`);
      return;
    }

    let apiKey: string | undefined;
    if (meta.apiKeyRequired) {
      apiKey = await vscode.window.showInputBox({
        prompt: `Enter API key for ${meta.name}`,
        placeHolder: `Paste your ${meta.envVarName} here`,
        password: true,
        ignoreFocusOut: true,
        title: `Agent-X: Configure ${meta.name} — API Key`,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) return 'API key is required';
          return undefined;
        },
      });
      if (!apiKey) return;
      apiKey = apiKey.trim();
    }

    let baseUrl: string | undefined;
    if (meta.baseUrlConfigurable) {
      baseUrl = await vscode.window.showInputBox({
        prompt: `Enter base URL for ${meta.name}`,
        placeHolder: meta.defaultBaseUrl || 'https://your-resource.openai.azure.com',
        value: deps.configBridge.getProviderBaseUrl(meta.id) || meta.defaultBaseUrl,
        ignoreFocusOut: true,
        title: `Agent-X: Configure ${meta.name} — Base URL`,
        validateInput: (value) => {
          if (value && value.trim().length > 0) {
            try { new URL(value); } catch { return 'Must be a valid URL'; }
          }
          if (meta.id === 'azure' && (!value || value.trim().length === 0)) {
            return 'Azure OpenAI requires a base URL';
          }
          return undefined;
        },
      });
      if (meta.id === 'azure' && !baseUrl) return;
      baseUrl = baseUrl?.trim() || meta.defaultBaseUrl;
    }

    try {
      if (apiKey) deps.configBridge.setProviderApiKey(meta.id, apiKey);
      if (baseUrl) deps.configBridge.setProviderBaseUrl(meta.id, baseUrl);
      await deps.configBridge.saveConfig();
      await deps.engineLifecycle.reloadProvider(meta.id);

      vscode.window.showInformationMessage(`Agent-X: Provider "${meta.name}" configured successfully.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to save provider config — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
