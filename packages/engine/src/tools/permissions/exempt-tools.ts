import {
  parseIntegrationToolId,
  isReadOnlyIntegrationTool,
} from '../../integrations/action-classifier.js';
import { getIntegrationProvider } from '../../integrations/catalog/index.js';

/** Read-only web research tools — never prompt for interactive permission. */
export const PERMISSION_EXEMPT_WEB_TOOLS = new Set([
  'web_search',
  'deep_web_search',
  'web_fetch',
  'web_scrape',
  'http_get',
  'web_browse',
]);

/** Scheduling catalog tools that are safe to run without an interactive prompt. */
export const PERMISSION_EXEMPT_AUTOMATION_TOOLS = new Set([
  'automation_register',
  'automation_list',
]);

/** Channel send tools — sending messages and files to the active conversation is a first-class
 * channel capability and should never require a separate permission prompt.
 * The file content is still scoped by the agent's scopePath and the path validation in ToolExecutor.
 */
export const PERMISSION_EXEMPT_CHANNEL_TOOLS = new Set([
  'telegram_send_message',
  'telegram_send_file',
  'slack_send_message',
  'slack_send_file',
  'discord_send_message',
  'discord_send_file',
  'email_send_message',
  'email_send_file',
]);

/**
 * True when a tool may run without an interactive permission prompt.
 * Only read/analyze/fetch tools qualify — shell, writes, and integration
 * auth/write tools must always go through the permission flow.
 */
export function isPermissionExemptTool(toolId: string): boolean {
  if (PERMISSION_EXEMPT_WEB_TOOLS.has(toolId)) return true;
  if (PERMISSION_EXEMPT_AUTOMATION_TOOLS.has(toolId)) return true;
  if (PERMISSION_EXEMPT_CHANNEL_TOOLS.has(toolId)) return true;
  const parsed = parseIntegrationToolId(toolId);
  if (parsed) {
    const provider = getIntegrationProvider(parsed.providerId);
    return isReadOnlyIntegrationTool(parsed.toolName, provider);
  }
  return false;
}
