import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptAgentOrchestration(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['sub_agent_spawn', 'sub_agent_status', 'sub_agent_cancel'],
    disabled: [],
  };
}
