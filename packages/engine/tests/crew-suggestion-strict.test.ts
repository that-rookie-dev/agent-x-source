import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '../src/session/SessionStore.js';
import { loadCatalogManifest } from '../src/crew/catalog-manifest.js';
import { CrewSuggestionService } from '../src/crew/CrewSuggestionService.js';

const manifest = loadCatalogManifest();
const BLACKHOLE_MSG = 'I need to know about blackholes. Who can help me?';

describe('strict crew suggestion — blackholes', () => {
  let store: SessionStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-strict-suggest-'));
    store = new SessionStore(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.skipIf(!manifest)('phase 1 matches astrophysics specialists via domain hints', async () => {
    const catalogStore = store.getCrewCatalogStore();
    await catalogStore.seedCatalog(manifest!);
    const svc = new CrewSuggestionService(catalogStore);

    const evaluation = await svc.evaluate({
      message: BLACKHOLE_MSG,
      sessionId: 'test-blackhole',
      priorUserMessages: [],
    });

    expect(evaluation.candidates.length).toBeGreaterThan(0);
    const hasRelevant = evaluation.candidates.some((c) =>
      /astro|physic|astronom|space/i.test(`${c.title} ${c.categoryLabel ?? ''}`),
    );
    expect(hasRelevant).toBe(true);

    const hasIrrelevant = evaluation.candidates.some((c) =>
      /usmle|servicenow|clinical knowledge|knowledge base/i.test(c.title),
    );
    expect(hasIrrelevant).toBe(false);
  }, 60_000);

  it.skipIf(!manifest)('returns empty when message has no substantive subject', async () => {
    const catalogStore = store.getCrewCatalogStore();
    await catalogStore.seedCatalog(manifest!);
    const svc = new CrewSuggestionService(catalogStore);

    const evaluation = await svc.evaluate({
      message: 'Who can help me?',
      sessionId: 'test-generic',
      priorUserMessages: [],
    });

    expect(evaluation.shouldSuggest).toBe(false);
    expect(evaluation.candidates).toEqual([]);
    expect(evaluation.reasons).toContain('no-substantive-tokens');
  }, 60_000);

  it.skipIf(!manifest)('phase 2 uses mocked LLM keywords for unknown topics', async () => {
    const catalogStore = store.getCrewCatalogStore();
    await catalogStore.seedCatalog(manifest!);
    const svc = new CrewSuggestionService(catalogStore);

    const evaluation = await svc.evaluate({
      message: 'I need to understand anglerfish bioluminescence. Who can help me?',
      sessionId: 'test-anglerfish',
      priorUserMessages: [],
      expandKeywords: async () => ['genetics', 'biology'],
    });

    expect(evaluation.candidates.length).toBeGreaterThan(0);
    expect(evaluation.reasons).toContain('llm-keyword-match');
  }, 60_000);
});
