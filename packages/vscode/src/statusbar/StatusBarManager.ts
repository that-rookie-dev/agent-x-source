import * as vscode from 'vscode';
import { ConfigBridge } from '../adapter/ConfigBridge';
import { EngineLifecycle } from '../adapter/EngineLifecycle';

interface TokenUsage {
  used: number;
  total: number;
  percentage: number;
  cost: number;
}

export class StatusBarManager implements vscode.Disposable {
  private providerItem: vscode.StatusBarItem;
  private modelItem: vscode.StatusBarItem;
  private tokenItem: vscode.StatusBarItem;
  private sessionItem: vscode.StatusBarItem;
  private processingItem: vscode.StatusBarItem;
  private crewItem: vscode.StatusBarItem;
  private planModeItem: vscode.StatusBarItem;

  private spinnerInterval: ReturnType<typeof setInterval> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    _configBridge: ConfigBridge,
    _engineLifecycle: EngineLifecycle,
  ) {
    void _configBridge;
    void _engineLifecycle;
    this.providerItem = vscode.window.createStatusBarItem('agentx.provider', vscode.StatusBarAlignment.Left, 100);
    this.providerItem.name = 'Agent-X Provider';
    this.providerItem.command = 'agentx.switchProvider';
    this.providerItem.tooltip = 'Click to switch AI provider';
    this.disposables.push(this.providerItem);

    this.modelItem = vscode.window.createStatusBarItem('agentx.model', vscode.StatusBarAlignment.Left, 99);
    this.modelItem.name = 'Agent-X Model';
    this.modelItem.command = 'agentx.switchModel';
    this.modelItem.tooltip = 'Click to switch model';
    this.disposables.push(this.modelItem);

    this.tokenItem = vscode.window.createStatusBarItem('agentx.tokens', vscode.StatusBarAlignment.Left, 98);
    this.tokenItem.name = 'Agent-X Token Usage';
    this.tokenItem.command = 'agentx.showCost';
    this.tokenItem.tooltip = 'Click to view detailed token usage';
    this.disposables.push(this.tokenItem);

    this.sessionItem = vscode.window.createStatusBarItem('agentx.session', vscode.StatusBarAlignment.Left, 97);
    this.sessionItem.name = 'Agent-X Session';
    this.sessionItem.command = 'agentx.restoreSession';
    this.sessionItem.tooltip = 'Click to restore a session';
    this.disposables.push(this.sessionItem);

    this.processingItem = vscode.window.createStatusBarItem('agentx.processing', vscode.StatusBarAlignment.Left, 96);
    this.processingItem.name = 'Agent-X Processing';
    this.processingItem.command = 'agentx.cancelTask';
    this.processingItem.tooltip = 'Click to cancel current task';
    this.processingItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.disposables.push(this.processingItem);

    this.crewItem = vscode.window.createStatusBarItem('agentx.crew', vscode.StatusBarAlignment.Left, 95);
    this.crewItem.name = 'Agent-X Crew';
    this.crewItem.command = 'agentx.switchCrew';
    this.crewItem.tooltip = 'Click to switch crew';
    this.disposables.push(this.crewItem);

    this.planModeItem = vscode.window.createStatusBarItem('agentx.planMode', vscode.StatusBarAlignment.Left, 94);
    this.planModeItem.name = 'Agent-X Plan Mode';
    this.planModeItem.command = 'agentx.togglePlanMode';
    this.planModeItem.tooltip = 'Click to toggle plan approval mode';
    this.disposables.push(this.planModeItem);
  }

  initializeFromConfig(config: Record<string, unknown>): void {
    this.updateProviderIndicator((config as { provider?: { activeProvider?: string } }).provider?.activeProvider || 'unknown');
    this.updateModelIndicator((config as { provider?: { activeModel?: string } }).provider?.activeModel || 'unknown');
    this.tokenItem.hide();
    this.sessionItem.hide();
    this.processingItem.hide();
    this.planModeItem.hide();
  }

  updateProviderIndicator(providerId: string): void {
    const iconMap: Record<string, string> = {
      openai: '$(sparkle)',
      anthropic: '$(brain)',
      google: '$(globe)',
      ollama: '$(server)',
      lmstudio: '$(server)',
    };
    const icon = iconMap[providerId] || '$(circuit-board)';
    this.providerItem.text = `${icon} ${providerId}`;
    this.providerItem.show();
  }

  updateModelIndicator(modelId: string): void {
    const shortName = modelId.length > 25 ? modelId.slice(0, 22) + '...' : modelId;
    this.modelItem.text = `$(symbol-misc) ${shortName}`;
    this.modelItem.tooltip = `Model: ${modelId}\nClick to switch`;
    this.modelItem.show();
  }

  updateTokenUsage(usage: TokenUsage): void {
    const pct = usage.percentage;
    this.tokenItem.text = `$(pulse) ${formatTokenCount(usage.used)}/${formatTokenCount(usage.total)} (${pct.toFixed(0)}%)`;
    this.tokenItem.tooltip = `Tokens: ${usage.used.toLocaleString()} / ${usage.total.toLocaleString()}\nCost: $${usage.cost.toFixed(4)}\nClick for details`;

    if (pct < 50) {
      this.tokenItem.color = undefined;
      this.tokenItem.backgroundColor = undefined;
    } else if (pct < 80) {
      this.tokenItem.color = new vscode.ThemeColor('charts.yellow');
      this.tokenItem.backgroundColor = undefined;
    } else {
      this.tokenItem.color = new vscode.ThemeColor('errorForeground');
      this.tokenItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    this.tokenItem.show();
  }

  updateSessionIndicator(sessionId: string | undefined): void {
    if (!sessionId) {
      this.sessionItem.hide();
      return;
    }
    const truncated = sessionId.length > 12 ? sessionId.slice(0, 12) + '\u2026' : sessionId;
    this.sessionItem.text = `$(bookmark) ${truncated}`;
    this.sessionItem.tooltip = `Session: ${sessionId}\nClick to restore`;
    this.sessionItem.show();
  }

  updateProcessingStatus(status: 'idle' | 'processing' | 'error'): void {
    if (status === 'processing') {
      this.processingItem.text = '$(sync~spin) Processing...';
      this.processingItem.show();
    } else {
      this.processingItem.hide();
      if (this.spinnerInterval) {
        clearInterval(this.spinnerInterval);
        this.spinnerInterval = undefined;
      }
    }
  }

  updateCrewIndicator(crewName: string | undefined): void {
    if (!crewName) {
      this.crewItem.hide();
      return;
    }
    this.crewItem.text = `$(organization) ${crewName}`;
    this.crewItem.tooltip = `Crew: ${crewName}\nClick to switch`;
    this.crewItem.show();
  }

  updatePlanModeIndicator(active: boolean): void {
    if (active) {
      this.planModeItem.text = '$(checklist) Plan';
      this.planModeItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
      this.planModeItem.show();
    } else {
      this.planModeItem.hide();
    }
  }

  dispose(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
