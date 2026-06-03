import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptTesting(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['test_run', 'test_watch', 'test_coverage', 'test_create', 'benchmark_run'],
    disabled: [],
  };
}
