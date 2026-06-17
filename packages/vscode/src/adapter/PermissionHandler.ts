import * as vscode from 'vscode';
import type { EventBridge } from './EventBridge';
import type { Disposable, PermissionRequest, PermissionChoice } from './types';
import type { PermissionSettings } from './PermissionSettings';
import type { Agent } from '@agentx/engine';

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'file_read',
  'file_list',
  'file_search',
  'file_info',
  'code_search',
  'code_definition',
  'code_references',
  'code_diagnostics',
  'code_symbols',
  'code_hover',
  'code_completion',
  'git_status',
  'git_log',
  'git_diff',
  'git_branch_list',
  'git_remote_list',
  'git_show',
  'git_blame',
  'web_fetch',
  'web_search',
  'package_list',
  'package_info',
  'system_info',
  'system_env',
  'ai_summarize',
  'ai_classify',
  'data_parse',
  'data_transform',
  'data_validate',
]);

export function isReadOnlyTool(toolId: string): boolean {
  return READ_ONLY_TOOLS.has(toolId);
}

interface PendingPermission {
  request: PermissionRequest;
  resolve: (choice: PermissionChoice) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  responded: boolean;
}

export class PermissionHandler implements vscode.Disposable {
  private disposables: Disposable[] = [];
  private pendingQueue: PendingPermission[] = [];
  private currentPending: PendingPermission | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly eventBridge: EventBridge,
    private readonly settings: PermissionSettings,
    outputChannel: vscode.OutputChannel,
  ) {
    this.outputChannel = outputChannel;
    this.disposables.push(
      this.eventBridge.onPermission((req) => this.handlePermissionRequest(req)),
    );
  }

  setAgent(agent: Agent): void {
    this.agent = agent;
  }

  private agent: Agent | null = null;

  private handlePermissionRequest(request: PermissionRequest): void {
    this.outputChannel.appendLine(
      `[Permission] Request: ${request.tool} on ${request.path} (risk: ${request.riskLevel})`,
    );

    const autoDecision = this.evaluateAutoApprove(request);
    if (autoDecision) {
      this.outputChannel.appendLine(
        `[Permission] Auto-approved: ${request.tool} (${autoDecision})`,
      );
      this.resolveToEngine(request, autoDecision);
      return;
    }

    const defaultDecision = this.settings.getDefaultDecision();
    if (defaultDecision === 'allow') {
      this.resolveToEngine(request, 'allow_once');
      return;
    }
    if (defaultDecision === 'deny') {
      this.resolveToEngine(request, 'deny');
      return;
    }

    this.enqueueRequest(request);
  }

  private evaluateAutoApprove(request: PermissionRequest): PermissionChoice | null {
    if (this.settings.getAutoApproveReadOnly() && isReadOnlyTool(request.tool)) {
      return 'allow_once';
    }

    if (this.settings.getAutoApproveLowRisk() && request.riskLevel === 'low') {
      return 'allow_once';
    }

    return null;
  }

  private enqueueRequest(request: PermissionRequest): void {
    const pending: PendingPermission = {
      request,
      resolve: (choice: PermissionChoice) => {
        if (pending.responded) return;
        pending.responded = true;
        clearTimeout(pending.timeoutHandle);
        this.resolveToEngine(request, choice);
        this.removeFromQueue(pending);
        this.processNext();
      },
      timeoutHandle: null as unknown as ReturnType<typeof setTimeout>,
      responded: false,
    };

    const timeoutMs = this.settings.getTimeout() * 1000;
    pending.timeoutHandle = setTimeout(() => {
      if (!pending.responded) {
        this.outputChannel.appendLine(
          `[Permission] Timeout: ${request.tool} — auto-denying after ${this.settings.getTimeout()}s`,
        );
        vscode.window.showWarningMessage(
          `Agent-X: Permission request for "${request.tool}" timed out and was denied.`,
        );
        pending.resolve('deny');
      }
    }, timeoutMs);

    this.pendingQueue.push(pending);

    if (!this.currentPending) {
      this.processNext();
    }
  }

  private processNext(): void {
    if (this.pendingQueue.length === 0) {
      this.currentPending = null;
      return;
    }

    const next = this.pendingQueue[0];
    if (!next || next.responded) {
      this.pendingQueue.shift();
      this.processNext();
      return;
    }

    this.currentPending = next;
    this.showUIForRequest(next);
  }

  private removeFromQueue(pending: PendingPermission): void {
    const index = this.pendingQueue.indexOf(pending);
    if (index !== -1) {
      this.pendingQueue.splice(index, 1);
    }
    if (this.currentPending === pending) {
      this.currentPending = null;
    }
  }

  private resolveToEngine(request: PermissionRequest, choice: PermissionChoice): void {
    if (this.agent) {
      this.agent.respondToPermission(request.requestId, choice);
    }
  }

  private async showUIForRequest(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const riskLevel = request.riskLevel.toLowerCase();

    switch (riskLevel) {
      case 'critical':
        await this.showCriticalModal(pending);
        break;
      case 'high':
        await this.showHighRiskNotification(pending);
        break;
      case 'medium':
        await this.showMediumRiskNotification(pending);
        break;
      case 'low':
        await this.showLowRiskNotification(pending);
        break;
      default:
        await this.showMediumRiskNotification(pending);
        break;
    }
  }

  private async showCriticalModal(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X wants to run "${request.tool}" on:\n${request.path}\n\nThis is a CRITICAL risk operation.`;

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail: 'This action may cause irreversible changes. Please review carefully.' },
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }

  private async showHighRiskNotification(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X: "${request.tool}" wants to access ${request.path} (High Risk)`;

    const choice = await vscode.window.showWarningMessage(
      message,
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }

  private async showMediumRiskNotification(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X: "${request.tool}" on ${request.path}`;

    const choice = await vscode.window.showInformationMessage(
      message,
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }

  private async showLowRiskNotification(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X: "${request.tool}" on ${request.path} (Low Risk)`;

    const choice = await vscode.window.showInformationMessage(
      message,
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }

  cancelAllPending(): void {
    for (const pending of this.pendingQueue) {
      if (!pending.responded) {
        clearTimeout(pending.timeoutHandle);
        pending.responded = true;
        pending.resolve('deny');
      }
    }
    this.pendingQueue = [];
    this.currentPending = null;
  }

  getPendingCount(): number {
    return this.pendingQueue.filter((p) => !p.responded).length;
  }

  dispose(): void {
    this.cancelAllPending();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
