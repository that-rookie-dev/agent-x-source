import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptWebNetwork(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'http_get', 'http_post', 'http_request',
      'web_scrape', 'web_search', 'http_download', 'web_browse',
    ],
    disabled: [],
  };
}
