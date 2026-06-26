import { describe, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '../src/session/SessionStore.js';
import { loadCatalogManifest } from '../src/crew/catalog-manifest.js';
import { CrewSuggestionService } from '../src/crew/CrewSuggestionService.js';
import { filterSubstantiveMatches, rowSearchBlob } from '../src/crew/crew-match-quality.js';
import { scoreMatchCandidates } from '../src/crew/CrewMatchService.js';

const manifest = loadCatalogManifest();

describe('trace full Phase 2', () => {
  it('check scores', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'debug-fts7-'));
    const store = new SessionStore(join(tempDir, 'test.db'));
    const catalogStore = store.getCrewCatalogStore();
    await catalogStore.seedCatalog(manifest!);

    // Replicate searchAndScore for Phase 2 with 'biology' keyword
    const expanded = ['biology'];
    const expandedQuery = 'biology';
    const [catalogHits, rosterHits] = await Promise.all([
      catalogStore.searchCatalog(expandedQuery, 20),
      catalogStore.searchRosterCrews(expandedQuery, 20),
    ]);
    
    const rows: any[] = [];
    for (const hit of catalogHits) {
      rows.push({
        id: hit.id,
        origin: 'hub_catalog',
        callsign: hit.callsign,
        name: hit.name,
        title: hit.title,
        categoryId: hit.categoryId,
        categoryLabel: hit.categoryLabel,
        description: hit.description,
        expertise: hit.expertise,
        traits: hit.traits,
        tone: hit.tone,
        catalogId: hit.id,
        onRoster: false,
        enabled: false,
        ftsRank: hit.ftsRank,
        systemPrompt: '',
        requiresMedicalDisclaimer: false,
      });
    }
    
    const filtered = filterSubstantiveMatches(rows, expanded);
    console.log(`After filter: ${filtered.length} rows`);
    for (const f of filtered) {
      console.log(`  ${f.callsign}: ftsRank=${f.ftsRank}`);
    }

    if (filtered.length > 0) {
      // Try scoring with the actual task
      const task = 'I need to understand anglerfish bioluminescence. Who can help me?';
      const svc = new CrewSuggestionService(catalogStore);
      
      // Call the actual evaluate
      const evaluation = await svc.evaluate({
        message: task,
        sessionId: 'test-anglerfish',
        priorUserMessages: [],
        expandKeywords: async () => ['biology'],
      });
      console.log(`\nEvaluate results: reasons=${JSON.stringify(evaluation.reasons)}, candidates=${evaluation.candidates.length}`);
      if (evaluation.candidates.length > 0) {
        console.log(`First: ${evaluation.candidates[0].callsign} score=${evaluation.candidates[0].matchScore}`);
      }
    }

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }, 30_000);
});
