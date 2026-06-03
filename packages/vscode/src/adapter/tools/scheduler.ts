import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptScheduler(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['reminder_set', 'reminder_list', 'reminder_cancel'],
    disabled: [],
  };
}
