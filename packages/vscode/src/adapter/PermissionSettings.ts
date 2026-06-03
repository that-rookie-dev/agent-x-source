import * as vscode from 'vscode';

export type DefaultDecision = 'ask' | 'allow' | 'deny';

export class PermissionSettings implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('agentx.permissions')) {
          this.changeEmitter.fire();
        }
      }),
    );
  }

  getAutoApproveLowRisk(): boolean {
    return vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<boolean>('autoApproveLowRisk', false);
  }

  getAutoApproveReadOnly(): boolean {
    return vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<boolean>('autoApproveReadOnly', true);
  }

  getTimeout(): number {
    const value = vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<number>('timeout', 60);
    return Math.max(5, Math.min(600, value));
  }

  getDefaultDecision(): DefaultDecision {
    return vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<DefaultDecision>('defaultDecision', 'ask');
  }

  async setAutoApproveLowRisk(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('autoApproveLowRisk', value, vscode.ConfigurationTarget.Global);
  }

  async setAutoApproveReadOnly(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('autoApproveReadOnly', value, vscode.ConfigurationTarget.Global);
  }

  async setTimeout(seconds: number): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('timeout', seconds, vscode.ConfigurationTarget.Global);
  }

  async setDefaultDecision(value: DefaultDecision): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('defaultDecision', value, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {
    this.changeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
