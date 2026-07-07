import { describe, it, expect } from 'vitest';
import {
  NEURAL_BRAIN_MIN_RAM_GB,
  STYLETTS2_MIN_RAM_GB,
  LOCAL_MODEL_MIN_RAM_GB,
  VOICE_WARMUP_MIN_RAM_GB,
  getSystemMemoryGB,
  isNeuralBrainSupported,
  isStyleTtsSupported,
  isLocalModelSupported,
  isVoiceWarmupSupported,
  buildPublicSystemCapabilities,
} from '../src/utils/system-capabilities.js';

describe('system-capabilities', () => {
  it('rounds memory to one decimal GB', () => {
    expect(getSystemMemoryGB(8 * 1024 ** 3)).toBe(8);
    expect(getSystemMemoryGB(8.44 * 1024 ** 3)).toBe(8.4);
  });

  it('requires 16GB for neural brain', () => {
    expect(NEURAL_BRAIN_MIN_RAM_GB).toBe(16);
    expect(isNeuralBrainSupported(15.9)).toBe(false);
    expect(isNeuralBrainSupported(16)).toBe(true);
    expect(isNeuralBrainSupported(32)).toBe(true);
  });

  it('requires 32GB for local models', () => {
    expect(LOCAL_MODEL_MIN_RAM_GB).toBe(32);
    expect(isLocalModelSupported(31.9)).toBe(false);
    expect(isLocalModelSupported(32)).toBe(true);
  });

  it('requires 16GB for StyleTTS 2', () => {
    expect(STYLETTS2_MIN_RAM_GB).toBe(16);
    expect(isStyleTtsSupported(15.9)).toBe(false);
    expect(isStyleTtsSupported(16)).toBe(true);
  });

  it('requires 8GB for optional voice warm-up at launch', () => {
    expect(VOICE_WARMUP_MIN_RAM_GB).toBe(8);
    expect(isVoiceWarmupSupported(7.9)).toBe(false);
    expect(isVoiceWarmupSupported(8)).toBe(true);
  });

  it('builds public capability flags from bytes', () => {
    const caps8 = buildPublicSystemCapabilities(8 * 1024 ** 3);
    expect(caps8.totalMemoryGB).toBe(8);
    expect(caps8.neuralBrainSupported).toBe(false);
    expect(caps8.styleTtsSupported).toBe(false);
    expect(caps8.localModelSupported).toBe(false);
    expect(caps8.voiceWarmupSupported).toBe(true);

    const caps4 = buildPublicSystemCapabilities(4 * 1024 ** 3);
    expect(caps4.voiceWarmupSupported).toBe(false);

    const caps32 = buildPublicSystemCapabilities(32 * 1024 ** 3);
    expect(caps32.neuralBrainSupported).toBe(true);
    expect(caps32.styleTtsSupported).toBe(true);
    expect(caps32.localModelSupported).toBe(true);
    expect(caps32.voiceWarmupSupported).toBe(true);
  });
});
