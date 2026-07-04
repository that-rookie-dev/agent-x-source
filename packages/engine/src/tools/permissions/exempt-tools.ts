import { isToolAllowedInPlanMode } from '../../agent/plan-mode-utils.js';

/** Read-only web research tools — never prompt for interactive permission. */
export const PERMISSION_EXEMPT_WEB_TOOLS = new Set([
  'web_search',
  'deep_web_search',
  'web_fetch',
  'web_scrape',
  'http_get',
  'web_browse',
]);

/** True when a tool may run without an interactive permission prompt (read/analyze/fetch only). */
export function isPermissionExemptTool(toolId: string): boolean {
  if (PERMISSION_EXEMPT_WEB_TOOLS.has(toolId)) return true;
  return isToolAllowedInPlanMode(toolId);
}
