/** RAM threshold (GB): BGE-M3 tier vs MiniLM tier for Neural Cortex embeddings. */
export const NEURAL_CORTEX_BGE_MIN_RAM_GB = 16;

export type NeuralCortexEmbeddingTier = 'bge-m3' | 'minilm' | 'ngram';

export function resolveNeuralCortexEmbeddingTier(totalMemoryGB: number): Exclude<NeuralCortexEmbeddingTier, 'ngram'> {
  return totalMemoryGB >= NEURAL_CORTEX_BGE_MIN_RAM_GB ? 'bge-m3' : 'minilm';
}

/** Provenance / source origin codes (patterned enum). */
export const KnowledgeBaseOrigin = {
  documentUpload: 'kb.document.upload',
  documentReprocess: 'kb.document.reprocess',
} as const;

export const CortexOrigin = {
  sessionHub: 'cortex.session.hub',
  chatTurn: 'cortex.chat.turn',
  chatProfile: 'cortex.chat.profile',
  systemBenchmark: 'cortex.system.benchmark',
} as const;

export type KnowledgeBaseOriginCode = typeof KnowledgeBaseOrigin[keyof typeof KnowledgeBaseOrigin];
export type CortexOriginCode = typeof CortexOrigin[keyof typeof CortexOrigin];

export interface NeuralCortexCapabilities {
  totalMemoryGB: number;
  neuralCortexEmbeddingTier: Exclude<NeuralCortexEmbeddingTier, 'ngram'>;
  cortexReady: boolean;
  cortexDegraded: boolean;
  activeTier: NeuralCortexEmbeddingTier | null;
}
