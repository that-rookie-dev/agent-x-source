import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptDataProcessing(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'json_parse', 'json_query', 'json_set', 'csv_parse',
      'text_transform', 'regex_match', 'text_diff', 'validate_schema',
    ],
    disabled: [],
  };
}
