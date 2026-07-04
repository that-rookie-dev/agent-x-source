import { describe, it, expect } from 'vitest';
import {
  nativeRecordToModelInfo,
  resolveGeminiReasoningInfo,
  mapReasoningEffortToThinkingLevel,
  buildGoogleAiSdkProviderOptions,
  buildProviderConnectivityProbeUrl,
  resolveGoogleNativeBaseUrl,
} from '../src/providers/google/gemini-metadata.js';

describe('resolveGeminiReasoningInfo', () => {
  it('returns effort levels for gemini-3.5-flash from docs matrix', () => {
    const info = resolveGeminiReasoningInfo({
      name: 'models/gemini-3.5-flash',
      baseModelId: 'gemini-3.5-flash',
      thinking: true,
      supportedGenerationMethods: ['generateContent'],
    });
    expect(info?.effortLevels).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(info?.defaultEffort).toBe('medium');
  });

  it('includes none for gemini-2.5-flash', () => {
    const info = resolveGeminiReasoningInfo({
      name: 'models/gemini-2.5-flash',
      baseModelId: 'gemini-2.5-flash',
      thinking: true,
      supportedGenerationMethods: ['generateContent'],
    });
    expect(info?.effortLevels).toContain('none');
    expect(info?.effortLevels).not.toContain('minimal');
  });

  it('returns undefined when thinking is false', () => {
    expect(resolveGeminiReasoningInfo({
      name: 'models/gemini-2.0-flash',
      baseModelId: 'gemini-2.0-flash',
      thinking: false,
      supportedGenerationMethods: ['generateContent'],
    })).toBeUndefined();
  });
});

describe('nativeRecordToModelInfo', () => {
  it('maps native API fields to ModelInfo', () => {
    const info = nativeRecordToModelInfo({
      name: 'models/gemini-3.5-flash',
      baseModelId: 'gemini-3.5-flash',
      displayName: 'Gemini 3.5 Flash',
      inputTokenLimit: 1_048_576,
      outputTokenLimit: 65_536,
      thinking: true,
      supportedGenerationMethods: ['generateContent'],
    });
    expect(info?.id).toBe('gemini-3.5-flash');
    expect(info?.name).toBe('Gemini 3.5 Flash');
    expect(info?.contextWindow).toBe(1_048_576);
    expect(info?.outputTokenLimit).toBe(65_536);
    expect(info?.reasoning?.supported).toBe(true);
    expect(info?.capabilities).toContain('reasoning');
  });
});

describe('buildGoogleAiSdkProviderOptions', () => {
  it('maps effort to thinkingLevel for AI SDK', () => {
    expect(buildGoogleAiSdkProviderOptions('gemini-3.5-flash', 'low')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'low' } },
    });
  });

  it('uses thinkingBudget 0 for none on 2.5 flash', () => {
    expect(buildGoogleAiSdkProviderOptions('gemini-2.5-flash', 'none')).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0 } },
    });
  });
});

describe('buildProviderConnectivityProbeUrl', () => {
  it('uses native models.list for google without breaking v1beta', () => {
    const url = buildProviderConnectivityProbeUrl(
      'google',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'test-key',
    );
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=test-key&pageSize=1');
    expect(url).not.toContain('/beta/openai');
  });

  it('appends /models for openai-style base urls', () => {
    expect(buildProviderConnectivityProbeUrl('openai', 'https://api.openai.com/v1', 'k'))
      .toBe('https://api.openai.com/v1/models');
  });
});

describe('resolveGoogleNativeBaseUrl', () => {
  it('strips /openai suffix from configured base url', () => {
    expect(resolveGoogleNativeBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai'))
      .toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});

describe('mapReasoningEffortToThinkingLevel', () => {
  it('rejects none', () => {
    expect(mapReasoningEffortToThinkingLevel('none', 'gemini-3.5-flash')).toBeUndefined();
  });
});
