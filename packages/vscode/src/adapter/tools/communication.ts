import * as vscode from 'vscode';
import type { ToolResult } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptCommunication(
  refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };

  // ── notify_desktop ──
  refs.executor.registerHandler('notify_desktop', async (args): Promise<ToolResult> => {
    const title = args['title'] as string;
    const message = args['message'] as string;

    if (!title || !message) {
      return { success: false, output: 'title and message are required', error: 'MISSING_INPUT' };
    }

    await vscode.window.showInformationMessage(
      `${title}: ${message}`,
      'OK',
    );
    return { success: true, output: `Notification shown: ${title} - ${message}` };
  });
  result.overridden.push('notify_desktop');

  // ── clipboard_read ──
  refs.executor.registerHandler('clipboard_read', async (): Promise<ToolResult> => {
    try {
      const text = await vscode.env.clipboard.readText();
      return { success: true, output: text || '(clipboard empty)' };
    } catch (error) {
      return { success: false, output: `Clipboard read failed: ${(error as Error).message}`, error: 'CLIPBOARD_ERROR' };
    }
  });
  result.overridden.push('clipboard_read');

  // ── clipboard_write ──
  refs.executor.registerHandler('clipboard_write', async (args): Promise<ToolResult> => {
    const text = args['text'] as string;
    if (text === undefined) {
      return { success: false, output: 'text is required', error: 'MISSING_INPUT' };
    }
    try {
      await vscode.env.clipboard.writeText(text);
      return { success: true, output: `Copied to clipboard: ${text.length > 50 ? text.slice(0, 50) + '...' : text}` };
    } catch (error) {
      return { success: false, output: `Clipboard write failed: ${(error as Error).message}`, error: 'CLIPBOARD_ERROR' };
    }
  });
  result.overridden.push('clipboard_write');

  // ── Kept as-is ──
  result.keptAsIs.push('notify_telegram', 'notify_slack', 'telegram_send_file');

  return result;
}
