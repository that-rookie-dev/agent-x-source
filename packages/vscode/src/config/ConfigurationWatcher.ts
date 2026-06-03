import * as vscode from 'vscode';
import { ConfigBridge } from '../adapter/ConfigBridge';
import { EngineLifecycle } from '../adapter/EngineLifecycle';
import { StatusBarManager } from '../statusbar/StatusBarManager';

export class ConfigurationWatcher implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor(
    private configBridge: ConfigBridge,
    private engineLifecycle: EngineLifecycle,
    private statusBarManager: StatusBarManager,
  ) {
    this.disposable = vscode.workspace.onDidChangeConfiguration((event) => this.onConfigurationChanged(event));
  }

  private async onConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (!event.affectsConfiguration('agentx')) return;

    const config = vscode.workspace.getConfiguration('agentx');

    if (event.affectsConfiguration('agentx.provider')) {
      const provider = config.get<string>('provider');
      if (provider) {
        this.configBridge.setActiveProvider(provider);
        await this.engineLifecycle.switchProvider(provider);
        this.statusBarManager.updateProviderIndicator(provider);
      }
    }

    if (event.affectsConfiguration('agentx.model')) {
      const model = config.get<string>('model');
      if (model) {
        this.configBridge.setActiveModel(model);
        await this.engineLifecycle.switchModel(model);
        this.statusBarManager.updateModelIndicator(model);
      }
    }

    if (event.affectsConfiguration('agentx.autoApprove')) {
      const autoApprove = config.get<string[]>('autoApprove') || [];
      this.configBridge.setAutoApproveCategories(autoApprove);
      await this.engineLifecycle.updatePermissionConfig(autoApprove);
    }

    if (event.affectsConfiguration('agentx.theme')) {
      const theme = config.get<string>('theme') || 'auto';
      this.configBridge.setWebviewTheme(theme);
      await vscode.commands.executeCommand('agentx.chatView.refreshTheme');
    }

    if (event.affectsConfiguration('agentx.maxBudget')) {
      const maxBudget = config.get<number>('maxBudget') || 0;
      this.configBridge.setMaxBudget(maxBudget);
      await this.engineLifecycle.updateBudgetLimit(maxBudget);
    }

    if (event.affectsConfiguration('agentx.planMode')) {
      const planMode = config.get<boolean>('planMode') || false;
      this.configBridge.setPlanMode(planMode);
      await this.engineLifecycle.setPlanMode(planMode);
      this.statusBarManager.updatePlanModeIndicator(planMode);
    }

    if (event.affectsConfiguration('agentx.provider') || event.affectsConfiguration('agentx.model')) {
      const needsRestart = this.engineLifecycle.requiresRestartForConfigChange();
      if (needsRestart && this.engineLifecycle.hasActiveAgent()) {
        const restart = await vscode.window.showWarningMessage(
          'Agent-X: Provider/model change requires an engine restart. Restart now?',
          'Restart',
          'Later',
        );
        if (restart === 'Restart') {
          await this.engineLifecycle.disposeCurrentAgent();
          await this.engineLifecycle.createAgent();
        }
      }
    }
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
