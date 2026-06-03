import * as vscode from 'vscode';
import { execSync } from 'node:child_process';
import type { ToolResult } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptSystemOs(
  refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };

  // ── open_app ──
  refs.executor.registerHandler('open_app', async (args): Promise<ToolResult> => {
    const target = args['target'] as string;
    if (!target) return { success: false, output: 'target is required', error: 'MISSING_INPUT' };

    try {
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const opened = await vscode.env.openExternal(vscode.Uri.parse(target));
        return { success: opened, output: opened ? `Opened URL: ${target}` : 'Failed to open URL' };
      }
      const cmd = process.platform === 'win32' ? `start "" "${target}"` : `open "${target}"`;
      execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
      return { success: true, output: `Opened: ${target}` };
    } catch (error) {
      return { success: false, output: `Failed to open: ${(error as Error).message}`, error: 'OPEN_ERROR' };
    }
  });
  result.overridden.push('open_app');

  // ── Kept as-is ──
  result.keptAsIs.push(
    'system_info', 'system_disk', 'system_env', 'system_which', 'system_ports',
    'system_tree_size', 'security_audit', 'security_secrets', 'file_checksum',
    'system_monitor', 'cron_create',
  );

  return result;
}
