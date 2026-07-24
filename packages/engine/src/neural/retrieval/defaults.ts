/**
 * Central defaults for grounded retrieval (see GROUNDED_EMBEDDING_RETRIEVAL_PLAN.md).
 * Call sites must read from here / config — no divergent magic numbers.
 */
export const RETRIEVAL_DEFAULTS = {
  chunkTargetChars: 1200,
  chunkMaxChars: 1800,
  chunkMinChars: 200,
  chunkOverlapChars: 120,
  embedPrefixEnabled: true,
  /** Memory / chat fabric vector floor (was 0.35). */
  minScoreMemory: 0.42,
  /** Knowledge-base / source_doc floor (was 0.25). */
  minScoreKb: 0.40,
  vectorOverFetch: 40,
  lexicalOverFetch: 40,
  rerankKeep: 8,
  injectKeep: 6,
  maxEvidenceCharsFull: 4000,
  maxEvidenceCharsCompact: 1500,
  maxEvidenceLineChars: 500,
  maxChunksPerSource: 3,
  graphExpandDepth: 1,
  graphExpandOnlyOnTopHits: 2,
  useOrderEdgesForExpand: true,
  similarityEdgeMinScore: 0.82,
  similarityEdgeMaxDegree: 5,
  /** Hybrid FTS path — lexicalSearch degrades gracefully if content_tsv missing. */
  hybridEnabled: true,
  rerankEnabled: true,
  evidenceOnlyPrompt: true,
  /** Prefetch candidate limits before gate/rerank. */
  vectorLimit: 8,
  userProfileLimit: 8,
  episodicLimit: 5,
  kbChunkLimit: 5,
} as const;

export type RetrievalDefaults = typeof RETRIEVAL_DEFAULTS;
