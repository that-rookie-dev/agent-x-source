/** Minimum system RAM (GB) to enable neural brain, RAG Studio, and ONNX embedding models. */
export const NEURAL_BRAIN_MIN_RAM_GB = 16;

/** Minimum system RAM (GB) to offer StyleTTS 2 (heavy TTS model + PyTorch stack). */
export const STYLETTS2_MIN_RAM_GB = 16;

/** Minimum system RAM (GB) to offer local LLM model downloads in setup. */
export const LOCAL_MODEL_MIN_RAM_GB = 32;

export function getSystemMemoryGB(totalBytes: number): number {
  return Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
}

export function isNeuralBrainSupported(totalMemoryGB: number): boolean {
  return totalMemoryGB >= NEURAL_BRAIN_MIN_RAM_GB;
}

export function isStyleTtsSupported(totalMemoryGB: number): boolean {
  return totalMemoryGB >= STYLETTS2_MIN_RAM_GB;
}

export function isLocalModelSupported(totalMemoryGB: number): boolean {
  return totalMemoryGB >= LOCAL_MODEL_MIN_RAM_GB;
}

export interface PublicSystemCapabilities {
  totalMemoryGB: number;
  localModelSupported: boolean;
  neuralBrainSupported: boolean;
  styleTtsSupported: boolean;
}

export function buildPublicSystemCapabilities(totalBytes: number): PublicSystemCapabilities {
  const totalMemoryGB = getSystemMemoryGB(totalBytes);
  return {
    totalMemoryGB,
    localModelSupported: isLocalModelSupported(totalMemoryGB),
    neuralBrainSupported: isNeuralBrainSupported(totalMemoryGB),
    styleTtsSupported: isStyleTtsSupported(totalMemoryGB),
  };
}
