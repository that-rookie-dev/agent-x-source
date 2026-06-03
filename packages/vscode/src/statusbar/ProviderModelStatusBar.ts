import * as vscode from 'vscode';
import type { ProviderId, CrewEmotion } from '@agentx/shared';
import { getProviderMeta } from '../commands/ProviderPicker';

export interface ProviderModelStatusBarItems {
  providerItem: vscode.StatusBarItem;
  modelItem: vscode.StatusBarItem;
  crewItem: vscode.StatusBarItem;
  modelTrialItem: vscode.StatusBarItem;
}

export function createProviderModelStatusBar(): ProviderModelStatusBarItems {
  const providerItem = vscode.window.createStatusBarItem(
    'agentx.provider',
    vscode.StatusBarAlignment.Left,
    100,
  );
  providerItem.name = 'Agent-X Provider';
  providerItem.command = 'agentx.switchProvider';
  providerItem.tooltip = new vscode.MarkdownString('**Agent-X Provider**\n\nClick to switch AI provider');

  const modelItem = vscode.window.createStatusBarItem(
    'agentx.model',
    vscode.StatusBarAlignment.Left,
    99,
  );
  modelItem.name = 'Agent-X Model';
  modelItem.command = 'agentx.switchModel';
  modelItem.tooltip = new vscode.MarkdownString('**Agent-X Model**\n\nClick to switch model');

  const crewItem = vscode.window.createStatusBarItem(
    'agentx.crew',
    vscode.StatusBarAlignment.Left,
    95,
  );
  crewItem.name = 'Agent-X Crew';
  crewItem.command = 'agentx.switchCrew';
  crewItem.tooltip = new vscode.MarkdownString('**Agent-X Crew**\n\nClick to switch crew/profile');

  const modelTrialItem = vscode.window.createStatusBarItem(
    'agentx.modelTrial',
    vscode.StatusBarAlignment.Left,
    98,
  );
  modelTrialItem.name = 'Agent-X Model Trial';
  modelTrialItem.text = '$(sync~spin) Testing model...';
  modelTrialItem.tooltip = 'Pre-flight check in progress';
  modelTrialItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

  return { providerItem, modelItem, crewItem, modelTrialItem };
}

export function updateProviderStatusBar(
  item: vscode.StatusBarItem,
  providerId: ProviderId | string,
  sessionId?: string,
): void {
  const meta = getProviderMeta(providerId as ProviderId);
  const icon = meta?.icon || '$(circuit-board)';
  const name = meta?.name || String(providerId);
  const typeLabel = meta?.type === 'local' ? ' (local)' : '';

  item.text = `${icon} ${name}${typeLabel}`;

  const tooltipLines = [
    '**Agent-X Provider**',
    '',
    `Provider: **${name}** (${providerId})`,
    `Type: ${meta?.type || 'unknown'}`,
    `API Key: ${meta?.apiKeyRequired ? 'Required' : 'Not required'}`,
  ];
  if (sessionId) {
    tooltipLines.push(`Session: \`${sessionId.slice(0, 12)}\``);
  }
  tooltipLines.push('', '---', '*Click to switch provider*');

  item.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));
  item.show();
}

export function updateModelStatusBar(
  item: vscode.StatusBarItem,
  modelId: string,
  contextWindow?: number,
): void {
  const shortName = modelId.length > 25 ? modelId.slice(0, 22) + '...' : modelId;
  const ctxLabel = contextWindow ? ` (${formatCtx(contextWindow)})` : '';

  item.text = `$(symbol-misc) ${shortName}${ctxLabel}`;

  const tooltipLines = [
    '**Agent-X Model**',
    '',
    `Model: **${modelId}**`,
  ];
  if (contextWindow) {
    tooltipLines.push(`Context Window: ${contextWindow.toLocaleString()} tokens`);
  }
  tooltipLines.push('', '---', '*Click to switch model*');

  item.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));
  item.show();
}

export function updateCrewStatusBar(
  item: vscode.StatusBarItem,
  crewName: string,
  _emotion?: CrewEmotion,
): void {
  item.text = `$(organization) ${crewName}`;
  item.tooltip = new vscode.MarkdownString(
    ['**Agent-X Crew**', '', `Crew: **${crewName}**`, '', '---', '*Click to switch crew*'].join('\n'),
  );
  item.show();
}

export function showModelTrialIndicator(item: vscode.StatusBarItem, modelId: string): void {
  item.text = `$(sync~spin) Testing ${modelId.length > 15 ? modelId.slice(0, 12) + '...' : modelId}...`;
  item.tooltip = `Pre-flight check for ${modelId}`;
  item.show();
}

export function hideModelTrialIndicator(item: vscode.StatusBarItem): void {
  item.hide();
}

export function showProviderError(
  item: vscode.StatusBarItem,
  providerId: string,
  errorMsg: string,
): void {
  item.text = `$(error) ${providerId}`;
  item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  item.tooltip = new vscode.MarkdownString(
    `**Provider Error**\n\n${providerId}: ${errorMsg}\n\n---\n*Click to reconfigure*`,
  );
  item.command = 'agentx.configureProvider';
  item.show();
}

export function clearProviderError(item: vscode.StatusBarItem): void {
  item.backgroundColor = undefined;
  item.command = 'agentx.switchProvider';
}

function formatCtx(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}
