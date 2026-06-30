import { getEngine } from './engine.js';
import { getLogger } from '@agentx/shared';
import { ProviderFactory, UnifiedLocalModelProvider } from '@agentx/engine';
import type { GenerateFn } from '@agentx/engine';
import type { FeatureRoutingConfig } from '@agentx/shared';

/**
 * Build a text-generation function that routes to the local model or the
 * active cloud provider based on a feature-routing key.
 *
 * Used by `buildDistillationGenerator` (memoryDistillation) and
 * `buildGraphRagGenerator` (graphRagExtraction / graphRagSummarization).
 */
async function buildRoutedGenerator(
  routeKey: keyof FeatureRoutingConfig,
  fallbackRouteKey?: keyof FeatureRoutingConfig,
  label: string = routeKey,
): Promise<GenerateFn | null> {
  const eng = getEngine();
  try {
    const cfg = eng.configManager.load();

    // Resolve the effective route: explicit setting, or fall back to the
    // fallback route, or default to 'cloud'.
    const effectiveRoute = cfg.featureRouting?.[routeKey]
      ?? (fallbackRouteKey ? cfg.featureRouting?.[fallbackRouteKey] : undefined)
      ?? 'cloud';

    if (cfg.localModel?.enabled && cfg.localModel.modelName && cfg.localModel.cacheDir) {
      if (effectiveRoute === 'local') {
        try {
          const localProvider = new UnifiedLocalModelProvider({
            modelName: cfg.localModel.modelName,
            cacheDir: cfg.localModel.cacheDir,
            dtype: cfg.localModel.dtype ?? 'q4',
          });
          return async (prompt: string) => localProvider.generate(prompt, { maxTokens: 2048, temperature: 0.1 });
        } catch (e) {
          getLogger().warn(label, `Local model failed, falling back to cloud: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const providerId = cfg.provider.activeProvider;
    const providerCfg = cfg.provider.providers?.[providerId];
    if (!providerCfg?.configured || !providerCfg?.apiKey) return null;
    const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
    const model = cfg.provider.activeModel || 'gpt-4o-mini';
    return async (prompt: string, options?: { maxTokens?: number }) => {
      let text = '';
      const request = {
        model,
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0,
        maxTokens: options?.maxTokens ?? 4096,
        stream: false,
      };
      for await (const chunk of provider.complete(request)) {
        if (chunk.type === 'text_delta' && chunk.content) text += chunk.content;
      }
      return text;
    };
  } catch (e) {
    getLogger().warn(label, `Failed to build LLM generator: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Build a text-generation function suitable for memory
 * extraction / distillation. Prefers a configured local model and falls back
 * to the active cloud provider.
 */
export async function buildDistillationGenerator(): Promise<GenerateFn | null> {
  return buildRoutedGenerator('memoryDistillation', undefined, 'DISTILLATION');
}

/**
 * Build a text-generation function for GraphRAG entity/relation extraction.
 * Routes via `featureRouting.graphRagExtraction`, falling back to
 * `memoryDistillation`'s setting if unset.
 */
export async function buildGraphRagGenerator(): Promise<GenerateFn | null> {
  return buildRoutedGenerator('graphRagExtraction', 'memoryDistillation', 'GRAPHRAG_EXTRACTION');
}

/**
 * Build a text-generation function for GraphRAG community summarization.
 * Routes via `featureRouting.graphRagSummarization`, falling back to
 * `graphRagExtraction` then `memoryDistillation`.
 */
export async function buildGraphRagSummarizer(): Promise<GenerateFn | null> {
  return buildRoutedGenerator('graphRagSummarization', 'graphRagExtraction', 'GRAPHRAG_SUMMARY');
}
