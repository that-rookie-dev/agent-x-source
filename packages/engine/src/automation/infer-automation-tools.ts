import type { AutomationNotifyChannel } from '@agentx/shared';
import { isPermissionExemptTool } from '../tools/permissions/exempt-tools.js';

export const NOTIFY_TOOL_IDS = new Set([
  'notify_desktop',
  'notify_telegram',
  'notify_slack',
  'notify_email',
  'notify_discord',
]);

/** Tools that need explicit user consent before an automation is registered. */
export function requiresAutomationToolConsent(toolId: string): boolean {
  if (NOTIFY_TOOL_IDS.has(toolId)) return true;
  return !isPermissionExemptTool(toolId);
}

/** Heuristic inference of tools the automation worker may invoke from instruction + channels. */
export function inferAutomationTools(
  instruction: string,
  notifyChannels?: AutomationNotifyChannel[],
  explicit?: string[],
): string[] {
  const tools = new Set<string>((explicit ?? []).map((t) => t.trim()).filter(Boolean));
  const lower = instruction.toLowerCase();

  if (/\b(news|search|web|fetch|look\s*up|research|headlines|google|browse|internet|online|article)\b/.test(lower)) {
    tools.add('web_search');
    tools.add('deep_web_search');
  }

  if (/\b(write|save to file|create file|append to file|export to)\b/.test(lower)) {
    tools.add('file_write');
    tools.add('write_file');
  }

  if (/\b(edit|modify|refactor|patch|implement|fix)\b/.test(lower) && /\b(code|file|repo|project)\b/.test(lower)) {
    tools.add('code_replace');
    tools.add('file_edit');
  }

  if (/\b(run|execute|bash|shell|command|script|terminal)\b/.test(lower)) {
    tools.add('bash');
  }

  if (/\b(remember|store in memory|memorize)\b/.test(lower)) {
    tools.add('memory_store');
  }

  if (notifyChannels?.includes('desktop')) tools.add('notify_desktop');
  if (notifyChannels?.includes('telegram')) tools.add('notify_telegram');
  if (notifyChannels?.includes('slack')) tools.add('notify_slack');
  if (notifyChannels?.includes('email')) tools.add('notify_email');
  if (notifyChannels?.includes('discord')) tools.add('notify_discord');

  return [...tools];
}

export function toolsNeedingConsent(toolIds: string[]): string[] {
  return [...new Set(toolIds)].filter(requiresAutomationToolConsent);
}
