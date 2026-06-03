import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptMcpIntegration(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['mcp_call', 'mcp_list_tools', 'mcp_server_connect', 'mcp_resource_read'],
    disabled: [],
  };
}
