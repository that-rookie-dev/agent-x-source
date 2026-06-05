import * as vscode from 'vscode';
import type { Agent } from '@agentx/engine';

export type SessionMode = 'agent' | 'ask' | 'plan';

interface ModeDefinition {
  id: SessionMode;
  label: string;
  description: string;
  icon: string;
}

const MODES: ModeDefinition[] = [
  { id: 'agent', label: 'Agent Mode', description: 'Full capabilities — tools, code execution, file modification', icon: '$(rocket)' },
  { id: 'ask', label: 'Ask Mode', description: 'Answer questions only — no tool execution', icon: '$(question)' },
  { id: 'plan', label: 'Plan Mode', description: 'Generate plans with approval — review before executing', icon: '$(list-ordered)' },
];

export class SessionModes implements vscode.Disposable {
  private mode: SessionMode = 'ask';
  private engine: Agent | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private _onModeChanged = new vscode.EventEmitter<SessionMode>();
  readonly onModeChanged = this._onModeChanged.event;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this.statusBarItem = statusBarItem;
    this.updateStatusBar();
  }

  attach(engine: Agent): void {
    this.engine = engine;
  }

  get currentMode(): SessionMode {
    return this.mode;
  }

  async switchMode(mode?: SessionMode): Promise<void> {
    if (!mode) {
      const currentDef = MODES.find(m => m.id === this.mode)!;
      const items = MODES.map(m => ({
        label: `${m.icon} ${m.label}`,
        description: m.id === this.mode ? '(active)' : '',
        detail: m.description,
        modeId: m.id,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Current mode: ${currentDef.label}`,
        title: 'Switch Session Mode',
      });

      if (!picked) return;
      mode = picked.modeId;
    }

    this.setMode(mode);
  }

  setMode(mode: SessionMode): void {
    if (mode === this.mode) return;

    this.mode = mode;

    if (this.engine) {
      switch (mode) {
        case 'agent':
        case 'ask':
          this.engine.setPlanMode(false);
          break;
        case 'plan':
          this.engine.setPlanMode(true);
          break;
      }
    }

    this.updateStatusBar();
    this._onModeChanged.fire(mode);

    const def = MODES.find(m => m.id === mode)!;
    vscode.window.showInformationMessage(`${def.icon} Switched to ${def.label}: ${def.description}`);
  }

  private updateStatusBar(): void {
    const def = MODES.find(m => m.id === this.mode)!;
    this.statusBarItem.text = `${def.icon} ${def.label.replace(' Mode', '')}`;
    this.statusBarItem.tooltip = `Agent-X: ${def.label}\n${def.description}\nClick to switch mode`;
    this.statusBarItem.command = 'agentx.session.switchMode';
    this.statusBarItem.show();
  }

  isReadOnly(): boolean {
    return this.mode === 'ask';
  }

  isPlanning(): boolean {
    return this.mode === 'plan';
  }

  dispose(): void {
    this._onModeChanged.dispose();
    this.statusBarItem.dispose();
  }
}
