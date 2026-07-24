/**
 * Citeable evidence packing for agent prompt injection.
 */

import { getLogger } from '@agentx/shared';
import { itemSimilarity, type ScoredItem } from './scoreGate.js';
import { RETRIEVAL_DEFAULTS } from './defaults.js';

export interface EvidenceUnit extends ScoredItem {
  id: string;
  label: string;
  category: string;
  content: string;
  provenance?: Record<string, unknown>;
  headingPath?: string[];
}

export function toEvidenceUnit(node: {
  id?: string;
  label?: string;
  category?: string;
  content?: string;
  sourceId?: string | null;
  distance?: number | null;
  provenance?: Record<string, unknown>;
  headingPath?: string[];
}, index: number): EvidenceUnit | null {
  if (!node.content?.trim()) return null;
  const id = node.id || `anon-${index}`;
  return {
    id,
    label: node.label || id.slice(0, 8),
    category: node.category || 'semantic',
    content: node.content,
    sourceId: node.sourceId,
    distance: node.distance,
    score: itemSimilarity({ distance: node.distance, content: node.content, score: null }),
    provenance: node.provenance,
    headingPath: node.headingPath,
  };
}

/** `[E12 · KB · Report.pdf · p.4 · Auth › JWT · score=0.71]` */
export function formatEvidenceCitation(unit: EvidenceUnit, evidenceIndex: number): string {
  const parts: string[] = [`E${evidenceIndex}`];
  const isKb = unit.category === 'source_doc' || !!unit.provenance?.['sourceName'];
  parts.push(isKb ? 'KB' : unit.category);
  const sourceName = String(unit.provenance?.['sourceName'] ?? unit.label ?? '').trim();
  if (sourceName) parts.push(sourceName.slice(0, 48));
  const page = unit.provenance?.['pageNumber'];
  if (typeof page === 'number') parts.push(`p.${page}`);
  const path = (unit.headingPath?.length
    ? unit.headingPath
    : Array.isArray(unit.provenance?.['headingPath'])
      ? (unit.provenance!['headingPath'] as string[])
      : [])
    .map((h) => String(h).replace(/^#+\s*/, ''))
    .filter(Boolean);
  if (path.length) parts.push(path.join(' › ').slice(0, 60));
  const score = itemSimilarity(unit);
  if (score > 0) parts.push(`score=${score.toFixed(2)}`);
  return `[${parts.join(' · ')}]`;
}

export interface PackEvidenceOptions {
  maxChars: number;
  maxLineChars?: number;
  startIndex?: number;
  /** When set, emit RETRIEVAL_PACK telemetry (kept vs candidate counts). */
  logLabel?: string;
  candidatesIn?: number;
}

export interface PackedEvidence {
  text: string;
  evidenceIds: string[];
  count: number;
  charsUsed: number;
}

/**
 * Pack evidence units into citeable lines under a char budget.
 */
export function packEvidenceBlocks(units: EvidenceUnit[], opts: PackEvidenceOptions): PackedEvidence {
  const maxLine = opts.maxLineChars ?? RETRIEVAL_DEFAULTS.maxEvidenceLineChars;
  const start = opts.startIndex ?? 1;
  const lines: string[] = [];
  const evidenceIds: string[] = [];
  let used = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const idx = start + i;
    const cite = formatEvidenceCitation(unit, idx);
    const body = unit.content.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').trim().slice(0, maxLine);
    const line = `- ${cite} ${body}`;
    if (used + line.length + 1 > opts.maxChars) break;
    lines.push(line);
    evidenceIds.push(unit.id);
    used += line.length + 1;
  }

  if (opts.logLabel) {
    const scores = units
      .slice(0, lines.length)
      .map((u) => itemSimilarity(u))
      .filter((s) => s > 0);
    const minScore = scores.length ? Math.min(...scores) : 0;
    getLogger().info('RETRIEVAL_PACK', opts.logLabel, {
      kept: lines.length,
      candidatesIn: opts.candidatesIn ?? units.length,
      dropped: Math.max(0, (opts.candidatesIn ?? units.length) - lines.length),
      charsUsed: used,
      maxChars: opts.maxChars,
      minScoreKept: Number(minScore.toFixed(3)),
    });
  }

  return { text: lines.join('\n'), evidenceIds, count: lines.length, charsUsed: used };
}

/** Explicit empty-evidence marker for the prompt contract. */
export const EMPTY_EVIDENCE_MARKER =
  'RETRIEVED_EVIDENCE: (none above confidence threshold) — do not invent facts from memory; use tools or ask for a source.';
