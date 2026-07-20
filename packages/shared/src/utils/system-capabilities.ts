import {
  NEURAL_CORTEX_BGE_MIN_RAM_GB,
  resolveNeuralCortexEmbeddingTier,
} from '../types/neural-cortex.js';

export {
  NEURAL_CORTEX_BGE_MIN_RAM_GB,
  resolveNeuralCortexEmbeddingTier,
};
export type { NeuralCortexEmbeddingTier, NeuralCortexCapabilities } from '../types/neural-cortex.js';

/** Minimum system RAM (GB) to offer local LLM model downloads in setup. */
export const LOCAL_MODEL_MIN_RAM_GB = 32;

/** Minimum system RAM (GB) to offer optional voice-engine warm-up at app launch. */
export const VOICE_WARMUP_MIN_RAM_GB = 8;

export function getSystemMemoryGB(totalBytes: number): number {
  return Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
}

export function isLocalModelSupported(totalMemoryGB: number): boolean {
  return totalMemoryGB >= LOCAL_MODEL_MIN_RAM_GB;
}

export function isVoiceWarmupSupported(totalMemoryGB: number): boolean {
  return totalMemoryGB >= VOICE_WARMUP_MIN_RAM_GB;
}

export interface PublicSystemCapabilities {
  totalMemoryGB: number;
  localModelSupported: boolean;
  neuralCortexEmbeddingTier: 'bge-m3' | 'minilm';
  /** True when BGE-M3 tier is recommended (16 GB+ RAM). */
  cortexReady: boolean;
  /** True when MiniLM tier is recommended (<16 GB RAM). */
  cortexDegraded: boolean;
  voiceWarmupSupported: boolean;
}

export function buildPublicSystemCapabilities(totalBytes: number): PublicSystemCapabilities {
  const totalMemoryGB = getSystemMemoryGB(totalBytes);
  const neuralCortexEmbeddingTier = resolveNeuralCortexEmbeddingTier(totalMemoryGB);
  const cortexReady = neuralCortexEmbeddingTier === 'bge-m3';
  const cortexDegraded = neuralCortexEmbeddingTier === 'minilm';
  return {
    totalMemoryGB,
    localModelSupported: isLocalModelSupported(totalMemoryGB),
    neuralCortexEmbeddingTier,
    cortexReady,
    cortexDegraded,
    voiceWarmupSupported: isVoiceWarmupSupported(totalMemoryGB),
  };
}
