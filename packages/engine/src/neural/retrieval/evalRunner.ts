/**
 * Offline retrieval eval over a synthetic corpus + golden queries.
 * Used for baseline freeze + CI Precision@5 regression gate.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyScoreGate, itemSimilarity } from './scoreGate.js';
import { heuristicRerank } from './rerank.js';
import { mergeRrf, type RankedCandidate } from './hybrid.js';
import { RETRIEVAL_DEFAULTS } from './defaults.js';

/** Local packer — avoids importing packer.ts (logger / shared) in CLI eval. */
function packUnits(
  items: Array<{ id: string; content: string; sourceName: string; headingPath: string[]; distance?: number }>,
  maxChars: number,
  maxLine: number,
): { evidenceIds: string[]; count: number; charsUsed: number } {
  const lines: string[] = [];
  const evidenceIds: string[] = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const unit = items[i]!;
    const score = unit.distance != null ? 1 - unit.distance : itemSimilarity(unit);
    const path = unit.headingPath.map((h) => h.replace(/^#+\s*/, '')).join(' › ');
    const cite = `[E${i + 1} · KB · ${unit.sourceName}${path ? ` · ${path}` : ''}${score > 0 ? ` · score=${score.toFixed(2)}` : ''}]`;
    const body = unit.content.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').trim().slice(0, maxLine);
    const line = `- ${cite} ${body}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    evidenceIds.push(unit.id);
    used += line.length + 1;
  }
  return { evidenceIds, count: lines.length, charsUsed: used };
}

export interface GoldenQuery {
  id: string;
  type: string;
  query: string;
  expect: string;
}

export interface CorpusChunk {
  id: string;
  sourceId: string;
  sourceName: string;
  headingPath: string[];
  content: string;
  relevantQueries: string[];
}

export interface EvalMetrics {
  precisionAt5: number;
  abstainAccuracy: number;
  medianEvidenceChars: number;
  prefetchP50Ms: number;
  findCount: number;
  abstainCount: number;
  queries: number;
}

export interface FrozenBaseline {
  version: number;
  precisionAt5: number;
  abstainAccuracy: number;
  medianEvidenceChars: number;
  prefetchP50Ms: number;
  maxPrecisionDropPts: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function defaultFixtureDir(): string {
  // src/neural/retrieval → ../../../tests/retrieval/fixtures
  return join(__dirname, '../../../tests/retrieval/fixtures');
}

export function loadGoldenQueries(dir = defaultFixtureDir()): GoldenQuery[] {
  const raw = JSON.parse(readFileSync(join(dir, 'golden-queries.json'), 'utf8')) as {
    queries: GoldenQuery[];
  };
  return raw.queries;
}

export function loadSyntheticCorpus(dir = defaultFixtureDir()): CorpusChunk[] {
  const raw = JSON.parse(readFileSync(join(dir, 'synthetic-corpus.json'), 'utf8')) as {
    chunks: CorpusChunk[];
  };
  return raw.chunks;
}

export function loadFrozenBaseline(dir = defaultFixtureDir()): FrozenBaseline {
  return JSON.parse(readFileSync(join(dir, 'baseline-metrics.json'), 'utf8')) as FrozenBaseline;
}

function lexicalRank(query: string, chunks: CorpusChunk[]): Array<CorpusChunk & { score: number }> {
  const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 1);
  return chunks
    .map((c) => {
      const hay = `${c.content} ${c.headingPath.join(' ')} ${c.sourceName}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.includes(t)) score += 1;
      }
      // Prefer exact phrase hits.
      if (hay.includes(query.toLowerCase())) score += 3;
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

function fakeDistance(query: string, chunk: CorpusChunk): number {
  const hay = chunk.content.toLowerCase();
  const q = query.toLowerCase();
  if (hay.includes(q)) return 0.12;
  const terms = q.split(/[^a-z0-9_]+/).filter((t) => t.length > 2);
  const hits = terms.filter((t) => hay.includes(t)).length;
  if (hits === 0) return 0.85;
  return Math.max(0.15, 0.7 - hits * 0.08);
}

/**
 * Simulate hybrid retrieve → gate → rerank → pack for one query.
 */
export function evaluateQuery(
  query: GoldenQuery,
  corpus: CorpusChunk[],
): {
  topIds: string[];
  hitRelevant: boolean;
  abstained: boolean;
  evidenceChars: number;
  latencyMs: number;
} {
  const t0 = performance.now();
  const vectorHits = corpus
    .map((c) => ({
      ...c,
      distance: fakeDistance(query.query, c),
      id: c.id,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, RETRIEVAL_DEFAULTS.vectorOverFetch);

  const lexicalHits = lexicalRank(query.query, corpus).slice(0, RETRIEVAL_DEFAULTS.lexicalOverFetch);

  const vectorRanked: RankedCandidate[] = vectorHits.map((c) => ({
    id: c.id,
    content: c.content,
    distance: c.distance,
    sourceId: c.sourceId,
  }));
  const lexicalRanked: RankedCandidate[] = lexicalHits.map((c) => ({
    id: c.id,
    content: c.content,
    score: c.score,
    sourceId: c.sourceId,
  }));
  const merged = mergeRrf(vectorRanked, lexicalRanked, { limit: RETRIEVAL_DEFAULTS.rerankKeep });

  let gated = applyScoreGate(merged, {
    minScore: RETRIEVAL_DEFAULTS.minScoreKb,
    maxPerSource: RETRIEVAL_DEFAULTS.maxChunksPerSource,
  });
  gated = heuristicRerank(query.query, gated).slice(0, RETRIEVAL_DEFAULTS.injectKeep);

  const units = gated
    .map((g) => {
      const chunk = corpus.find((c) => c.id === g.id);
      if (!chunk) return null;
      return {
        id: g.id,
        content: chunk.content,
        sourceName: chunk.sourceName,
        headingPath: chunk.headingPath,
        distance: g.distance ?? undefined,
      };
    })
    .filter((u): u is NonNullable<typeof u> => !!u);

  const packed = packUnits(
    units,
    RETRIEVAL_DEFAULTS.maxEvidenceCharsFull,
    RETRIEVAL_DEFAULTS.maxEvidenceLineChars,
  );

  const latencyMs = performance.now() - t0;
  const topIds = packed.evidenceIds.slice(0, 5);
  const relevant = new Set(
    corpus.filter((c) => c.relevantQueries.includes(query.id)).map((c) => c.id),
  );
  const hitRelevant = topIds.some((id) => relevant.has(id));
  const abstained = packed.count === 0;

  return {
    topIds,
    hitRelevant,
    abstained,
    evidenceChars: packed.charsUsed,
    latencyMs,
  };
}

export function runRetrievalEval(dir = defaultFixtureDir()): EvalMetrics {
  const queries = loadGoldenQueries(dir);
  const corpus = loadSyntheticCorpus(dir);

  let findHits = 0;
  let findTotal = 0;
  let abstainCorrect = 0;
  let abstainTotal = 0;
  const evidenceChars: number[] = [];
  const latencies: number[] = [];

  for (const q of queries) {
    const result = evaluateQuery(q, corpus);
    evidenceChars.push(result.evidenceChars);
    latencies.push(result.latencyMs);

    if (q.expect === 'abstain') {
      abstainTotal++;
      if (result.abstained || !result.hitRelevant) abstainCorrect++;
    } else if (q.expect === 'find' || q.expect === 'kb' || q.expect === 'chat_or_kb') {
      findTotal++;
      if (result.hitRelevant) findHits++;
    }
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const sortedChars = [...evidenceChars].sort((a, b) => a - b);
  const p50 = (arr: number[]) => (arr.length ? arr[Math.floor(arr.length / 2)]! : 0);

  return {
    precisionAt5: findTotal ? findHits / findTotal : 0,
    abstainAccuracy: abstainTotal ? abstainCorrect / abstainTotal : 1,
    medianEvidenceChars: p50(sortedChars),
    prefetchP50Ms: p50(sortedLat),
    findCount: findTotal,
    abstainCount: abstainTotal,
    queries: queries.length,
  };
}

export function assertBaselineGate(
  metrics: EvalMetrics,
  baseline: FrozenBaseline,
): { ok: boolean; reason?: string } {
  const dropPts = (baseline.precisionAt5 - metrics.precisionAt5) * 100;
  if (dropPts > baseline.maxPrecisionDropPts) {
    return {
      ok: false,
      reason: `Precision@5 dropped ${dropPts.toFixed(1)} pts (baseline ${(baseline.precisionAt5 * 100).toFixed(1)} → ${(metrics.precisionAt5 * 100).toFixed(1)}; max ${baseline.maxPrecisionDropPts})`,
    };
  }
  if (metrics.abstainAccuracy + 1e-9 < baseline.abstainAccuracy - 0.05) {
    return {
      ok: false,
      reason: `Abstain accuracy regressed: ${metrics.abstainAccuracy.toFixed(3)} < ${baseline.abstainAccuracy.toFixed(3)} - 0.05`,
    };
  }
  return { ok: true };
}
