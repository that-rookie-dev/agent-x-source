import * as vscode from 'vscode';
import type { ProviderId } from '@agentx/shared';
import type { CommandDeps } from './registerAllCommands';

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  icon: string;
  type: 'cloud' | 'local';
  apiKeyRequired: boolean;
  baseUrlConfigurable: boolean;
  defaultBaseUrl: string;
  envVarName: string;
  description: string;
}

export const PROVIDER_REGISTRY: ProviderMeta[] = [
  { id: 'openai', name: 'OpenAI', icon: '$(sparkle)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.openai.com/v1', envVarName: 'OPENAI_API_KEY', description: 'GPT-4o, GPT-4, o1, o3, etc.' },
  { id: 'anthropic', name: 'Anthropic', icon: '$(brain)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.anthropic.com', envVarName: 'ANTHROPIC_API_KEY', description: 'Claude 4 Sonnet, Claude 3.5 Opus, etc.' },
  { id: 'google', name: 'Google', icon: '$(globe)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://generativelanguage.googleapis.com', envVarName: 'GOOGLE_API_KEY', description: 'Gemini 2.5 Pro, Gemini 2.0 Flash, etc.' },
  { id: 'ollama', name: 'Ollama', icon: '$(server)', type: 'local', apiKeyRequired: false, baseUrlConfigurable: true, defaultBaseUrl: 'http://localhost:11434', envVarName: '', description: 'Local models via Ollama' },
  { id: 'lmstudio', name: 'LM Studio', icon: '$(server)', type: 'local', apiKeyRequired: false, baseUrlConfigurable: true, defaultBaseUrl: 'http://localhost:1234/v1', envVarName: '', description: 'Local models via LM Studio' },
  { id: 'moonshot', name: 'Moonshot', icon: '$(rocket)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.moonshot.ai/v1', envVarName: 'MOONSHOT_API_KEY', description: 'Kimi models via OpenAI-compatible API' },
  { id: 'deepseek', name: 'DeepSeek', icon: '$(search)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.deepseek.com', envVarName: 'DEEPSEEK_API_KEY', description: 'DeepSeek-V3, DeepSeek-R1 reasoning models' },
  { id: 'groq', name: 'Groq', icon: '$(zap)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.groq.com/openai/v1', envVarName: 'GROQ_API_KEY', description: 'Ultra-fast inference on LPU hardware' },
  { id: 'mistral', name: 'Mistral', icon: '$(wind)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.mistral.ai/v1', envVarName: 'MISTRAL_API_KEY', description: 'Mistral Large, Mixtral, Codestral, etc.' },
  { id: 'together', name: 'Together AI', icon: '$(people)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.together.xyz/v1', envVarName: 'TOGETHER_API_KEY', description: 'Open-source models hosted in the cloud' },
  { id: 'xai', name: 'xAI', icon: '$(star-empty)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.x.ai/v1', envVarName: 'XAI_API_KEY', description: 'Grok models from xAI' },
  { id: 'fireworks', name: 'Fireworks AI', icon: '$(flame)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', envVarName: 'FIREWORKS_API_KEY', description: 'Fast inference for open-source models' },
  { id: 'perplexity', name: 'Perplexity', icon: '$(question)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.perplexity.ai', envVarName: 'PERPLEXITY_API_KEY', description: 'Sonar models with built-in search' },
  { id: 'azure', name: 'Azure OpenAI', icon: '$(azure)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: true, defaultBaseUrl: '', envVarName: 'AZURE_OPENAI_API_KEY', description: 'Azure-hosted OpenAI models (requires resource endpoint)' },
  { id: 'cohere', name: 'Cohere', icon: '$(symbol-key)', type: 'cloud', apiKeyRequired: true, baseUrlConfigurable: false, defaultBaseUrl: 'https://api.cohere.com/compatibility/v1', envVarName: 'COHERE_API_KEY', description: 'Command R+, Command R, Embed models' },
];

export function getProviderMeta(id: ProviderId): ProviderMeta | undefined {
  return PROVIDER_REGISTRY.find((p) => p.id === id);
}

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  providerId: ProviderId;
}

export function showProviderPicker(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const activeProvider = deps.configBridge.getActiveProvider();

    const items: ProviderQuickPickItem[] = PROVIDER_REGISTRY.map((p) => {
      const isActive = p.id === activeProvider;
      const typeLabel = p.type === 'cloud' ? '$(cloud) Cloud' : '$(server) Local';
      const keyLabel = p.apiKeyRequired ? '$(key) API Key Required' : '$(pass) No Key Needed';

      return {
        label: isActive ? `$(check) ${p.icon} ${p.name}` : `${p.icon} ${p.name}`,
        description: `${typeLabel}  ${keyLabel}`,
        detail: p.description,
        providerId: p.id,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select AI provider',
      matchOnDescription: true,
      matchOnDetail: true,
      title: 'Agent-X: Switch Provider',
    });

    if (!selected) return;

    if (selected.providerId === activeProvider) {
      vscode.window.showInformationMessage(`Agent-X: Already using ${getProviderMeta(selected.providerId)?.name}.`);
      return;
    }

    try {
      const meta = getProviderMeta(selected.providerId);
      if (!meta) return;

      await configureAndSwitchProvider(deps, meta);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Provider switch failed — ${error instanceof Error ? error.message : String(error)}`);
      deps.outputChannel.appendLine(`[Agent-X] Provider switch error: ${error}`);
    }
  };
}

async function configureAndSwitchProvider(
  deps: CommandDeps,
  meta: ProviderMeta,
): Promise<void> {
  let apiKey: string | undefined;
  let baseUrl: string | undefined;

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
          return 'Azure OpenAI requires a base URL (resource endpoint)';
        }
        return undefined;
      },
    });

    if (meta.id === 'azure' && !baseUrl) return;
    baseUrl = baseUrl?.trim() || meta.defaultBaseUrl;
  }

  if (apiKey) {
    deps.configBridge.setProviderApiKey(meta.id, apiKey);
  }
  if (baseUrl) {
    deps.configBridge.setProviderBaseUrl(meta.id, baseUrl);
  }
  deps.configBridge.setActiveProvider(meta.id);
  await deps.configBridge.saveConfig();

  await deps.engineLifecycle.switchProvider(meta.id);
  deps.statusBarManager.updateProviderIndicator(meta.id);

  const models = await deps.engineLifecycle.getAvailableModels(meta.id);
  if (models.length > 0) {
    deps.configBridge.setActiveModel(models[0].id);
    deps.statusBarManager.updateModelIndicator(models[0].id);
  }

  vscode.window.showInformationMessage(`Agent-X: Switched to ${meta.name}.`);
  deps.outputChannel.appendLine(`[Agent-X] Provider switched to ${meta.id}.`);
}
