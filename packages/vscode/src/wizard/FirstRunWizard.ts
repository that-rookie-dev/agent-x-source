import * as vscode from 'vscode';
import { ConfigBridge } from '../adapter/ConfigBridge';

interface WizardResult {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  crew: string;
}

export class FirstRunWizard {
  constructor(private configBridge: ConfigBridge) {}

  async run(): Promise<boolean> {
    const welcome = await vscode.window.showInformationMessage(
      'Welcome to Agent-X! Let\u2019s set up your AI assistant. This will only take a minute.',
      'Get Started',
      'Skip (configure later)',
    );

    if (welcome !== 'Get Started') return false;

    try {
      const provider = await this.selectProvider();
      if (!provider) return false;

      let apiKey: string | undefined;
      const isLocal = ['ollama', 'lmstudio'].includes(provider);

      if (!isLocal) {
        apiKey = await this.enterApiKey(provider);
        if (apiKey === undefined) return false;
      }

      let baseUrl: string | undefined;
      if (isLocal) {
        baseUrl = await this.enterBaseUrl(provider);
      }

      const model = await this.selectModel(provider, apiKey, baseUrl);
      if (!model) return false;

      const crew = await this.selectCrew();

      await this.saveConfig({ provider, apiKey, baseUrl, model, crew });

      vscode.window.showInformationMessage(`Agent-X: Setup complete! Using ${provider}/${model}. You can change settings anytime via the command palette.`);

      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Setup failed — ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async selectProvider(): Promise<string | undefined> {
    interface ProviderItem extends vscode.QuickPickItem {
      providerId: string;
    }

    const items: ProviderItem[] = [
      { label: '$(sparkle) OpenAI', description: 'GPT-4o, GPT-4, o1, etc.', detail: 'Requires OPENAI_API_KEY', providerId: 'openai' },
      { label: '$(brain) Anthropic', description: 'Claude 3.5 Sonnet, Claude 3 Opus, etc.', detail: 'Requires ANTHROPIC_API_KEY', providerId: 'anthropic' },
      { label: '$(globe) Google', description: 'Gemini Pro, Gemini Ultra, etc.', detail: 'Requires GOOGLE_API_KEY', providerId: 'google' },
      { label: '$(server) Ollama', description: 'Local models via Ollama', detail: 'Runs locally \u2014 no API key needed', providerId: 'ollama' },
      { label: '$(server) LM Studio', description: 'Local models via LM Studio', detail: 'Runs locally \u2014 no API key needed', providerId: 'lmstudio' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select your AI provider',
      title: 'Agent-X Setup \u2014 Step 1/4: Provider',
      ignoreFocusOut: true,
    });

    return selected?.providerId;
  }

  private async enterApiKey(provider: string): Promise<string | undefined> {
    const envVarMap: Record<string, string> = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_API_KEY',
    };

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${provider} API key`,
      placeHolder: `Paste your ${envVarMap[provider] || 'API_KEY'} here`,
      password: true,
      ignoreFocusOut: true,
      title: 'Agent-X Setup \u2014 Step 2/4: API Key',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return 'API key is required';
        return undefined;
      },
    });

    return key?.trim();
  }

  private async enterBaseUrl(provider: string): Promise<string | undefined> {
    const defaultUrls: Record<string, string> = {
      ollama: 'http://localhost:11434',
      lmstudio: 'http://localhost:1234/v1',
    };

    const url = await vscode.window.showInputBox({
      prompt: `Enter the base URL for ${provider}`,
      placeHolder: defaultUrls[provider] || 'http://localhost:8080',
      value: defaultUrls[provider] || '',
      ignoreFocusOut: true,
      title: 'Agent-X Setup \u2014 Step 2/4: Base URL',
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

    return url?.trim() || defaultUrls[provider];
  }

  private async selectModel(provider: string, apiKey?: string, baseUrl?: string): Promise<string | undefined> {
    let models: Array<{ id: string; name: string; description?: string }> = [];

    try {
      models = await this.configBridge.fetchModelsForProvider(provider, apiKey, baseUrl);
    } catch {
      // Fallback: show manual input
    }

    if (models.length > 0) {
      interface ModelItem extends vscode.QuickPickItem {
        modelId: string;
      }

      const items: ModelItem[] = models.map((m) => ({
        label: m.name || m.id,
        description: m.description,
        modelId: m.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a model',
        title: 'Agent-X Setup \u2014 Step 3/4: Model',
        ignoreFocusOut: true,
        matchOnDescription: true,
      });

      return selected?.modelId;
    }

    const manualModel = await vscode.window.showInputBox({
      prompt: 'Enter model ID',
      placeHolder: this.getDefaultModelForProvider(provider),
      value: this.getDefaultModelForProvider(provider),
      ignoreFocusOut: true,
      title: 'Agent-X Setup \u2014 Step 3/4: Model (manual entry)',
      validateInput: (v) => (!v || v.trim().length === 0 ? 'Model ID required' : undefined),
    });

    return manualModel?.trim();
  }

  private async selectCrew(): Promise<string> {
    const crews = this.configBridge.getAvailableCrews();

    if (crews.length === 0) return 'default';

    interface CrewItem extends vscode.QuickPickItem {
      crewId: string;
    }

    const items: CrewItem[] = [
      { label: '$(person) Solo (no crew)', description: 'Single agent, no crew orchestration', crewId: 'default' },
      ...crews.map((c) => ({
        label: `$(organization) ${c.name}`,
        description: `${c.members?.length || 0} members`,
        crewId: c.id,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a crew (or solo mode)',
      title: 'Agent-X Setup \u2014 Step 4/4: Crew',
      ignoreFocusOut: true,
    });

    return selected?.crewId || 'default';
  }

  private async saveConfig(result: WizardResult): Promise<void> {
    this.configBridge.setActiveProvider(result.provider);

    if (result.apiKey) {
      this.configBridge.setProviderApiKey(result.provider, result.apiKey);
    }

    if (result.baseUrl) {
      this.configBridge.setProviderBaseUrl(result.provider, result.baseUrl);
    }

    this.configBridge.setActiveModel(result.model);
    this.configBridge.setActiveCrew(result.crew);

    await this.configBridge.saveConfig();
  }

  private getDefaultModelForProvider(provider: string): string {
    const defaults: Record<string, string> = {
      openai: 'gpt-4o',
      anthropic: 'claude-sonnet-4-20250514',
      google: 'gemini-2.0-flash',
      ollama: 'llama3',
      lmstudio: 'local-model',
    };
    return defaults[provider] || 'default';
  }
}
