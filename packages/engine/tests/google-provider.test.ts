import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleProvider, normalizeGoogleModelId } from '../src/providers/GoogleProvider.js';
import { collectCompletion } from '../src/benchmark/completion.js';

describe('normalizeGoogleModelId', () => {
  it('strips models/ prefix', () => {
    expect(normalizeGoogleModelId('models/gemini-2.0-flash')).toBe('gemini-2.0-flash');
    expect(normalizeGoogleModelId('gemini-2.0-flash')).toBe('gemini-2.0-flash');
  });
});

describe('GoogleProvider.complete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams text and reasoning_content from Gemini OpenAI-compat SSE', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"Let me think..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"0.05"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new TextEncoder().encode(sse) };
            },
            releaseLock: () => undefined,
          };
        },
      },
    })));

    const provider = new GoogleProvider('test-key');
    const result = await collectCompletion(provider, {
      model: 'models/gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hello' }],
      reasoningEffort: 'none',
      maxTokens: 32,
    });

    expect(result.text).toBe('0.05');
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.model).toBe('gemini-2.0-flash');
    expect(body.reasoning_effort).toBe('none');
  });
});

describe('GoogleProvider.listModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges paginated native models with reasoning metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/models?key=')) {
        return {
          ok: true,
          json: async () => ({
            models: [{
              name: 'models/gemini-3.5-flash',
              baseModelId: 'gemini-3.5-flash',
              displayName: 'Gemini 3.5 Flash',
              inputTokenLimit: 1_048_576,
              outputTokenLimit: 65_536,
              thinking: true,
              supportedGenerationMethods: ['generateContent'],
            }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'gemini-3.5-flash' }] }),
      };
    }));

    const provider = new GoogleProvider('test-key');
    const models = await provider.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('gemini-3.5-flash');
    expect(models[0]?.reasoning?.effortLevels).toContain('medium');
    expect(models[0]?.outputTokenLimit).toBe(65_536);
  });
});
