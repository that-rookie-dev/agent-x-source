import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import type { DeepSearchDepth, DeepSearchProgress, DeepSearchResultBundle } from '@agentx/shared';
import { runDeepSearchPipeline } from '../../search/pipeline.js';
import { hasActiveWebSearchProviders, webSearchProvidersUnavailableMessage } from '../../search/search-config.js';

export async function deepWebSearch(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const query = String(args.query ?? '').trim();
  if (!query) {
    return { success: false, output: 'query is required', error: 'MISSING_INPUT' };
  }

  const depth = (args.depth as DeepSearchDepth | undefined) ?? 'standard';
  const maxResults = typeof args.maxResults === 'number' ? args.maxResults : undefined;

  let lastProgress: DeepSearchProgress | undefined;
  const onProgress = (progress: DeepSearchProgress) => {
    lastProgress = progress;
    context.onOutput?.(JSON.stringify({ deepSearchProgress: progress }) + '\n');
  };

  if (!hasActiveWebSearchProviders()) {
    const message = webSearchProvidersUnavailableMessage();
    return {
      success: false,
      output: message,
      error: 'NO_SEARCH_PROVIDERS',
      metadata: {
        deepSearchProgress: { phase: 'done', message },
      },
    };
  }

  try {
    const bundle: DeepSearchResultBundle = await runDeepSearchPipeline(
      { query, depth, maxResults },
      onProgress,
    );

    return {
      success: bundle.results.length > 0,
      output: bundle.summary,
      metadata: {
        deepSearch: bundle,
        deepSearchProgress: lastProgress ?? { phase: 'done', message: 'Complete' },
      },
    };
  } catch (error) {
    return {
      success: false,
      output: `Deep web search failed: ${error instanceof Error ? error.message : String(error)}`,
      error: 'DEEP_SEARCH_ERROR',
    };
  }
}
