import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';
import { createDisabledHandler } from './types';

export function adaptBrowserAutomation(
  refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const reason = 'Browser automation via Playwright is not supported in the VS Code extension host';

  const tools = [
    'browser_open', 'browser_screenshot', 'browser_click',
    'browser_eval', 'browser_type', 'browser_extract',
  ];

  for (const toolId of tools) {
    refs.executor.registerHandler(toolId, createDisabledHandler(toolId, reason));
    result.disabled.push(toolId);
  }

  return result;
}
