export const INTEGRATION_TOOL_PREFIX = 'integration__';

export function isIntegrationToolId(toolId: string): boolean {
  return toolId.startsWith(INTEGRATION_TOOL_PREFIX);
}

export function parseIntegrationToolId(toolId: string): { providerId: string; toolName: string } | null {
  if (toolId.startsWith(INTEGRATION_TOOL_PREFIX)) {
    const rest = toolId.slice(INTEGRATION_TOOL_PREFIX.length);
    const sep = rest.indexOf('__');
    if (sep <= 0) return null;
    return {
      providerId: rest.slice(0, sep),
      toolName: rest.slice(sep + 2),
    };
  }

  return null;
}
