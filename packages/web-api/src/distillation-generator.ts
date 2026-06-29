import { getEngine } from './engine.js';
import { getLogger } from '@agentx/shared';
import { ProviderFactory, UnifiedLocalModelProvider } from '@agentx/engine';
import type { GenerateFn } from '@agentx/engine';

/**
 * Build a text-generation function suitable for GraphRAG-style memory
 * extraction / distillation. Prefers a configured local model and falls back
 * to the active cloud provider.
 */
export async function buildDistillationGenerator(): Promise<GenerateFn | null> {
  const eng = getEngine();
  if (!eng.configured) return null;
  try {
    const cfg = eng.configManager.load();

    if (cfg.localModel?.enabled && cfg.localModel.modelName && cfg.localModel.cacheDir) {
      if (cfg.featureRouting?.memoryDistillation === 'local' || !cfg.featureRouting?.memoryDistillation) {
        try {
          const localProvider = new UnifiedLocalModelProvider({
            modelName: cfg.localModel.modelName,
            cacheDir: cfg.localModel.cacheDir,
            dtype: cfg.localModel.dtype ?? 'q4',
          });
          return async (prompt: string) => localProvider.generate(prompt, { maxTokens: 2048, temperature: 0.1 });
        } catch (e) {
          getLogger().warn('DISTILLATION', `Local model failed, falling back to cloud: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const providerId = cfg.provider.activeProvider;
    const providerCfg = cfg.provider.providers?.[providerId];
    if (!providerCfg?.configured || !providerCfg?.apiKey) return null;
    const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
    const model = cfg.provider.activeModel || 'gpt-4o-mini';
    return async (prompt: string) => {
      let text = '';
      const request = {
        model,
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0,
        maxTokens: 2048,
        stream: false,
      };
      for await (const chunk of provider.complete(request)) {
        if (chunk.type === 'text_delta' && chunk.content) text += chunk.content;
      }
      return text;
    };
  } catch (e) {
    getLogger().warn('DISTILLATION', `Failed to build LLM generator: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
