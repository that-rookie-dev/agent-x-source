/** Read-only web research tools — never prompt for interactive permission. */
export const PERMISSION_EXEMPT_WEB_TOOLS = new Set([
  'web_search',
  'deep_web_search',
  'web_fetch',
  'web_scrape',
  'http_get',
  'web_browse',
]);

export function isPermissionExemptTool(toolId: string): boolean {
  return PERMISSION_EXEMPT_WEB_TOOLS.has(toolId);
}
