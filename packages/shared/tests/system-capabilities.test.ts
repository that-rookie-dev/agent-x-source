import { describe, it, expect } from 'vitest';
import {
  NEURAL_CORTEX_BGE_MIN_RAM_GB,
  LOCAL_MODEL_MIN_RAM_GB,
  VOICE_WARMUP_MIN_RAM_GB,
  getSystemMemoryGB,
  isLocalModelSupported,
  isVoiceWarmupSupported,
  buildPublicSystemCapabilities,
  resolveNeuralCortexEmbeddingTier,
} from '../src/utils/system-capabilities.js';

describe('system-capabilities', () => {
  it('rounds memory to one decimal GB', () => {
    expect(getSystemMemoryGB(8 * 1024 ** 3)).toBe(8);
    expect(getSystemMemoryGB(8.44 * 1024 ** 3)).toBe(8.4);
  });

  it('requires 16GB for BGE-M3 cortex tier', () => {
    expect(NEURAL_CORTEX_BGE_MIN_RAM_GB).toBe(16);
    expect(resolveNeuralCortexEmbeddingTier(15.9)).toBe('minilm');
    expect(resolveNeuralCortexEmbeddingTier(16)).toBe('bge-m3');
    expect(resolveNeuralCortexEmbeddingTier(32)).toBe('bge-m3');
  });

  it('requires 32GB for local models', () => {
    expect(LOCAL_MODEL_MIN_RAM_GB).toBe(32);
    expect(isLocalModelSupported(31.9)).toBe(false);
    expect(isLocalModelSupported(32)).toBe(true);
  });

  it('requires 8GB for optional voice warm-up at launch', () => {
    expect(VOICE_WARMUP_MIN_RAM_GB).toBe(8);
    expect(isVoiceWarmupSupported(7.9)).toBe(false);
    expect(isVoiceWarmupSupported(8)).toBe(true);
  });

  it('builds public capability flags from bytes', () => {
    const caps8 = buildPublicSystemCapabilities(8 * 1024 ** 3);
    expect(caps8.totalMemoryGB).toBe(8);
    expect(caps8.neuralCortexEmbeddingTier).toBe('minilm');
    expect(caps8.cortexReady).toBe(false);
    expect(caps8.cortexDegraded).toBe(true);
    expect(caps8.localModelSupported).toBe(false);
    expect(caps8.voiceWarmupSupported).toBe(true);

    const caps4 = buildPublicSystemCapabilities(4 * 1024 ** 3);
    expect(caps4.voiceWarmupSupported).toBe(false);
    expect(caps4.cortexDegraded).toBe(true);

    const caps32 = buildPublicSystemCapabilities(32 * 1024 ** 3);
    expect(caps32.neuralCortexEmbeddingTier).toBe('bge-m3');
    expect(caps32.cortexReady).toBe(true);
    expect(caps32.cortexDegraded).toBe(false);
    expect(caps32.localModelSupported).toBe(true);
    expect(caps32.voiceWarmupSupported).toBe(true);
  });
});
