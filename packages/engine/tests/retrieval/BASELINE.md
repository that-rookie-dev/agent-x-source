# Retrieval baseline inventory (Phase 0)

Captured / frozen 2026-07-21.

## Call sites

| Call site | File | Prior threshold | Prior limit | Notes |
|-----------|------|-----------------|-------------|-------|
| `vectorMemoryPrefetch` | `neural/VectorMemoryPrefetch.ts` | minRelevance **0.35** | vector 8 / profile 8 / episodic 5 | Hybrid + gate + expand; `rerankKeep`/`injectKeep` |
| `buildMemoryContext` KB chunks | `agent/agent-memory.ts` | **0.25** | 5 | `minScoreKb` 0.40; shared query embedding |
| `MemoryService.assembleContext` | `services/memory/MemoryService.ts` | minRelevance default **0.35** | 8 | Packer + `EMPTY_EVIDENCE_MARKER` |
| `searchKnowledgeBaseDocuments` | `knowledge-base/document-search.ts` | none (topK only) | topK×4 | Hybrid + score gate + expand + rerank |
| `knowledgeBaseSearch` tool | `tools/builtin/knowledge-base-search.ts` | n/a | 8 | Citeable `[E#]` via `formatKnowledgeBaseToolOutput` |
| `memory_search` / cortex tools | `aliases.ts`, `cortex-memory-search.ts` | none | 8/5 | Score-gated + packer |
| KB ingest embed | `DocumentIngestPipeline.ts` | n/a | batch 32 | `embedText` + `FOLLOWS` + async `RELATED_TO` |
| Re-embed | `fabric-persistence.ts` / `reEmbedSource` | raw content | batch 32 | Contextual embedText; no re-parse path |

## Defaults (`RETRIEVAL_DEFAULTS`)

| Knob | Value |
|------|------:|
| minScoreMemory | 0.42 |
| minScoreKb | 0.40 |
| vectorOverFetch | 40 |
| rerankKeep / injectKeep | 8 / 6 |
| maxEvidenceLineChars | 500 |
| maxEvidenceCharsFull / Compact | 4000 / 1500 |
| maxChunksPerSource | 3 |
| chunkTargetChars / overlap | 1200 / 120 |

## Frozen metrics (synthetic corpus × golden queries)

Source: `fixtures/baseline-metrics.json` via `evalRunner.ts`.

| Metric | Baseline (frozen) | Post (same harness) | Target |
|--------|-------------------|---------------------|--------|
| Precision@5 | **0.96** | 0.96 | ≥0.75 or baseline−5pts |
| Abstain accuracy | **1.00** | 1.00 | ≥0.85 |
| Median evidence chars | **889** | 889 | ≤1200 full |
| Prefetch p50 ms | **~0.06** (offline) | ~0.06 | ≤ baseline+10% |

CI gate: `assertBaselineGate` fails if Precision@5 drops **> 5 pts**.

Golden queries: `fixtures/golden-queries.json` (30).  
Corpus: `fixtures/synthetic-corpus.json`.  
Scenarios: `SCENARIOS.md`.
