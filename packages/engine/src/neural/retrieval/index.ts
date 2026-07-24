export { RETRIEVAL_DEFAULTS, type RetrievalDefaults } from './defaults.js';
export {
  getRetrievalSettings,
  setRetrievalOverrides,
  resetRetrievalOverrides,
  type RetrievalSettings,
} from './settings.js';
export {
  buildEmbedText,
  resolveEmbedTextForNode,
  normalizeEmbedBody,
  cleanHeadingLabel,
  extractHeadingPathFromContent,
  headingLevel,
  pushHeadingPath,
  type EmbedTextInput,
} from './contextualize.js';
export {
  similarityFromDistance,
  itemSimilarity,
  filterByMinScore,
  dedupeByContent,
  diversifyBySource,
  applyScoreGate,
  type ScoredItem,
} from './scoreGate.js';
export { heuristicRerank, type Rerankable } from './rerank.js';
export { mergeRrf, type RankedCandidate } from './hybrid.js';
export {
  expandEvidenceNeighborhood,
  type ExpandMode,
} from './expand.js';
export { linkSimilarChunks, nearDuplicate } from './similarityEdges.js';
export {
  toEvidenceUnit,
  formatEvidenceCitation,
  packEvidenceBlocks,
  EMPTY_EVIDENCE_MARKER,
  type EvidenceUnit,
  type PackEvidenceOptions,
  type PackedEvidence,
} from './packer.js';
export {
  runRetrievalEval,
  assertBaselineGate,
  loadFrozenBaseline,
  loadGoldenQueries,
  loadSyntheticCorpus,
  evaluateQuery,
  defaultFixtureDir,
  type EvalMetrics,
  type FrozenBaseline,
  type GoldenQuery,
  type CorpusChunk,
} from './evalRunner.js';
