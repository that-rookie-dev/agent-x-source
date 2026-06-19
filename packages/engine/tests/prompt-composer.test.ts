import { describe, it, expect } from 'vitest';
import { PromptComposer } from '../src/communication/prompt/PromptComposer.js';
import { PromptCache } from '../src/communication/prompt/PromptCache.js';
import type { NormalizedTurn, Session } from '@agentx/shared';

describe('PromptComposer', () => {
  const composer = new PromptComposer();
  const cache = new PromptCache();
  composer.setCache(cache);

  const makeSession = (overrides: Partial<Session> = {}): Session => ({
    id: 'sess-1',
    title: 'Test Session',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    scopePath: '/tmp/test',
    tokenUsed: 0,
    tokenAvailable: 128000,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  const makeTurn = (): NormalizedTurn => ({
    turnId: 'turn-1',
    sessionId: 'sess-1',
    cleanText: 'Hello, write a test',
    cleanAttachments: [],
    warnings: [],
  });

  it('composes a prompt with stable prefix and cache boundary', async () => {
    const bundle = await composer.compose(makeSession(), makeTurn());

    expect(bundle.stablePrefix).toBeTruthy();
    expect(bundle.cacheBoundary).toBe('\n<!-- AGENTX_CACHE_BOUNDARY -->\n');
    expect(bundle.dynamicSuffix).toBeTruthy();
    expect(bundle.volatileSuffix).toBeTruthy();
    expect(bundle.fullSystemPrompt).toContain(bundle.cacheBoundary);
    expect(bundle.stableHash).toHaveLength(16);
  });

  it('produces consistent stableHash for same content', async () => {
    const bundle1 = await composer.compose(makeSession(), makeTurn());
    const bundle2 = await composer.compose(makeSession(), makeTurn());

    expect(bundle1.stableHash).toBe(bundle2.stableHash);
  });

  it('includes provider overlay for known providers', async () => {
    const bundle = await composer.compose(makeSession({ providerId: 'anthropic' }), makeTurn());

    expect(bundle.providerOverlay).toBeTruthy();
    expect(bundle.providerOverlay).toContain('Anthropic');
  });

  it('returns empty overlay for unknown providers', async () => {
    const bundle = await composer.compose(makeSession({ providerId: 'unknown-svc' }), makeTurn());

    expect(bundle.providerOverlay).toBeUndefined();
  });
});
