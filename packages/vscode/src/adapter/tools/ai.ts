import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptAiMeta(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'ai_complete', 'ai_embed', 'ai_summarize',
      'ai_classify', 'ai_extract', 'memory_store', 'memory_recall',
    ],
    disabled: [],
  };
}
