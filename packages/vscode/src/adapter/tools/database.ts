import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptDatabase(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['db_query', 'db_schema', 'db_export', 'env_read', 'db_migrate'],
    disabled: [],
  };
}
