/**
 * Offline-mode verification routine.
 *
 * Verifies that the bundled local embedding model and optional local LLM judge
 * can produce output without network access. This is the Group 4 "verified
 * fully-offline mode" check.
 */
import { OnnxEmbeddingProvider } from './OnnxEmbeddingProvider.js';
import { LocalLLMJudge } from './LocalLLMJudge.js';

export interface OfflineVerificationResult {
  embedding: { ok: boolean; dimension: number; error?: string };
  llm: { ok: boolean; sample?: string; error?: string };
  fullyOffline: boolean;
}

export async function verifyOfflineMode(options: { checkLlm?: boolean; embeddingModel?: string; llmModel?: string } = {}): Promise<OfflineVerificationResult> {
  const result: OfflineVerificationResult = {
    embedding: { ok: false, dimension: 0 },
    llm: { ok: false },
    fullyOffline: false,
  };

  try {
    const embedder = new OnnxEmbeddingProvider(options.embeddingModel);
    const vector = await embedder.embed('The quick brown fox jumps over the lazy dog.');
    result.embedding = { ok: true, dimension: vector.length };
  } catch (e) {
    result.embedding.error = e instanceof Error ? e.message : String(e);
  }

  if (options.checkLlm !== false) {
    try {
      const judge = new LocalLLMJudge({ modelName: options.llmModel, maxNewTokens: 20 });
      const sample = await judge.generate('Say hello:', { maxTokens: 20 });
      result.llm = { ok: true, sample };
    } catch (e) {
      result.llm.error = e instanceof Error ? e.message : String(e);
    }
  }

  result.fullyOffline = result.embedding.ok && (options.checkLlm === false || result.llm.ok);
  return result;
}
